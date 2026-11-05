// Integration tests against DATABASE_URL_TEST (see vitest.config.ts). Each run uses its own
// users, transaction ids and calendar day, so runs never interfere and nothing is deleted
// (audit_logs is append-only and references users).
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "./schemas";
import { StoreError, commitIngest, commitIngestBatch, getReportData, reviewAlert, updateUser } from "./store";
import { db } from "./db";

const run = randomBytes(4).toString("hex");
// A distinct past day per run, at midday so the local date is unambiguous.
const dayMs = Date.UTC(2001, 0, 1) + (parseInt(run, 16) % 3000) * 86_400_000 + 12 * 3_600_000;
const day = (() => {
  const d = new Date(dayMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

let pool: Pool;
let admin: { uid: string; email: string; role: "admin" };
let analyst: { uid: string; email: string; role: "analyst" };

function tx(n: number, probability: number): Transaction {
  const isAlert = probability >= 0.5;
  return {
    id: `test-${run}-${n}`,
    externalId: `test-${run}-${n}`,
    time: n,
    amount: 10 * n,
    v: Array.from({ length: 28 }, () => 0),
    label: isAlert ? 1 : 0,
    probability,
    riskLevel: isAlert ? "high" : "low",
    isAlert,
    status: "scored",
    modelVersion: "test-model",
    thresholdUsed: 0.5,
    receivedAt: dayMs + n * 1000,
    latencyMs: 20,
    shadowProbability: null,
    shadowModelVersion: null,
  };
}

async function counters() {
  const { rows } = await pool.query("SELECT * FROM daily_stats WHERE day = $1", [day]);
  return rows[0];
}

/** What the counters SHOULD be, recounted from the rows themselves. */
async function recount() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM transactions WHERE received_at::date = $1::date) AS total,
       count(*)::int AS alerts,
       count(*) FILTER (WHERE status = 'open')::int AS open,
       count(*) FILTER (WHERE status = 'confirmed_fraud')::int AS confirmed_fraud,
       count(*) FILTER (WHERE status = 'false_positive')::int AS false_positive
     FROM alerts WHERE created_at::date = $1::date`,
    [day],
  );
  return rows[0];
}

async function expectCountersMatchRecount() {
  const [c, r] = await Promise.all([counters(), recount()]);
  expect({ total: c.total, alerts: c.alerts, open: c.open, confirmed_fraud: c.confirmed_fraud, false_positive: c.false_positive }).toEqual(r);
}

beforeAll(async () => {
  pool = db();
  expect(process.env.DATABASE_URL).toContain("_test"); // guard: never run against the real database
  await pool.query("INSERT INTO model_versions (version, stub) VALUES ('test-model', true) ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO settings (id, threshold, active_model_version) VALUES (1, 0.5, 'test-model') ON CONFLICT DO NOTHING");
  const mk = async (role: "admin" | "analyst") => {
    const email = `${role}-${run}@test.local`;
    const { rows } = await pool.query("INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', $2) RETURNING id", [email, role]);
    return { uid: rows[0].id as string, email, role };
  };
  admin = (await mk("admin")) as typeof admin;
  analyst = (await mk("analyst")) as typeof analyst;

  await commitIngest(tx(1, 0.91)); // alert
  await commitIngest(tx(2, 0.77)); // alert
  await commitIngest(tx(3, 0.05)); // not an alert
});

afterAll(async () => {
  await pool.end();
});

describe("store (PostgreSQL)", () => {
  it("counts each ingested transaction and alert once", async () => {
    const c = await counters();
    expect([c.total, c.alerts, c.open]).toEqual([3, 2, 2]);
    await expectCountersMatchRecount();
  });

  it("rejects a duplicate transaction id with 409 and leaves the counters alone", async () => {
    await expect(commitIngest(tx(1, 0.91))).rejects.toMatchObject({ status: 409 });
    await expectCountersMatchRecount();
  });

  it("lets an analyst review an open alert, but not change it afterwards", async () => {
    const a = await reviewAlert(tx(1, 0).id, "confirmed_fraud", "card used abroad", analyst);
    expect(a.status).toBe("confirmed_fraud");
    expect(a.reviewedBy).toBe(analyst.email);
    const err = await reviewAlert(tx(1, 0).id, "false_positive", undefined, analyst).catch((e) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect(err.status).toBe(403);
    await expectCountersMatchRecount();
  });

  it("keeps the counters equal to a recount when an admin changes a decision twice", async () => {
    await reviewAlert(tx(1, 0).id, "false_positive", "merchant confirmed", admin);
    await expectCountersMatchRecount();
    await reviewAlert(tx(1, 0).id, "confirmed_fraud", "chargeback received", admin);
    await expectCountersMatchRecount();
    await reviewAlert(tx(2, 0).id, "false_positive", undefined, admin);
    const c = await counters();
    expect([c.open, c.confirmed_fraud, c.false_positive]).toEqual([0, 1, 1]);
    await expectCountersMatchRecount();
  });

  it("rejects a no-op decision and an unknown alert", async () => {
    await expect(reviewAlert(tx(1, 0).id, "confirmed_fraud", undefined, admin)).rejects.toMatchObject({ status: 409 });
    await expect(reviewAlert(`missing-${run}`, "confirmed_fraud", undefined, admin)).rejects.toMatchObject({ status: 404 });
  });

  it("writes one audit entry per review and refuses to modify or delete audit entries", async () => {
    const { rows } = await pool.query("SELECT action, actor_email, before, after FROM audit_logs WHERE target = ANY($1) ORDER BY id", [
      [`alerts/${tx(1, 0).id}`, `alerts/${tx(2, 0).id}`],
    ]);
    expect(rows.map((r) => [r.actor_email, r.before.status, r.after.status])).toEqual([
      [analyst.email, "open", "confirmed_fraud"],
      [admin.email, "confirmed_fraud", "false_positive"],
      [admin.email, "false_positive", "confirmed_fraud"],
      [admin.email, "open", "false_positive"],
    ]);
    await expect(pool.query("UPDATE audit_logs SET action = 'x' WHERE target = $1", [`alerts/${tx(1, 0).id}`])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM audit_logs WHERE target = $1", [`alerts/${tx(1, 0).id}`])).rejects.toThrow(/append-only/);
  });
});

describe("batch ingest", () => {
  it("stores a batch in one write, skipping ids already stored or repeated, and keeps the counters exact", async () => {
    const shadowed = { ...tx(10, 0.95), shadowProbability: 0.4, shadowModelVersion: "test-shadow" };
    const outcome = await commitIngestBatch([shadowed, tx(11, 0.2), tx(1, 0.91), tx(11, 0.2), tx(12, 0.6)]);
    expect(outcome.committed.map((t) => t.id)).toEqual([tx(10, 0).id, tx(11, 0).id, tx(12, 0).id]);
    expect(outcome.duplicates).toEqual([tx(1, 0).id, tx(11, 0).id]);

    const c = await counters();
    expect([c.total, c.alerts]).toEqual([6, 4]);
    await expectCountersMatchRecount();

    const { rows } = await pool.query("SELECT shadow_probability, shadow_model_version FROM transactions WHERE id = $1", [shadowed.id]);
    expect(rows[0]).toEqual({ shadow_probability: 0.4, shadow_model_version: "test-shadow" });
  });

  it("reports the period from the same counters", async () => {
    const data = await getReportData(day, day);
    expect(data.days).toHaveLength(1);
    expect(data.days[0].total).toBe(6);
    // Labelled rows judged at their own threshold: tx 1, 2, 10, 12 flagged and labelled fraud; 3 and 11 cleared, labelled legit.
    expect(data.labelled).toMatchObject({ n: 6, positives: 4, tp: 4, fp: 0, fn: 0, tn: 2 });
    expect(data.topAlerts[0].id).toBe(tx(10, 0).id);
  });
});

describe("user management", () => {
  it("refuses an admin removing their own access", async () => {
    await expect(updateUser(admin.uid, { role: "analyst" }, admin)).rejects.toMatchObject({ status: 403 });
    await expect(updateUser(admin.uid, { active: false }, admin)).rejects.toMatchObject({ status: 403 });
  });

  it("changes another user's role and active flag, with one audit entry each, and never logs the hash", async () => {
    await updateUser(analyst.uid, { role: "admin" }, admin);
    await updateUser(analyst.uid, { role: "analyst", active: false, passwordHash: "new-hash" }, admin);
    const { rows: user } = await pool.query("SELECT role, active, password_hash FROM users WHERE id = $1", [analyst.uid]);
    expect(user[0]).toEqual({ role: "analyst", active: false, password_hash: "new-hash" });

    const { rows } = await pool.query("SELECT before, after FROM audit_logs WHERE action = 'user.update' AND target = $1 ORDER BY id", [
      `users/${analyst.uid}`,
    ]);
    expect(rows.map((r) => [r.before.role, r.after.role, r.after.active, r.after.passwordReset ?? false])).toEqual([
      ["analyst", "admin", true, false],
      ["admin", "analyst", false, true],
    ]);
    expect(JSON.stringify(rows)).not.toContain("new-hash");
  });

  it("404s an unknown user", async () => {
    await expect(updateUser("00000000-0000-4000-8000-000000000000", { active: true }, admin)).rejects.toMatchObject({ status: 404 });
  });
});
