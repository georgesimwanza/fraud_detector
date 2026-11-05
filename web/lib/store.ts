import "server-only";
import type { PoolClient } from "pg";
import { db } from "./db";
import type { Actor, Alert, AlertStatus, AuditEntry, Config, DailyStats, Decision, Explanation, Role, Transaction, UserRow } from "./schemas";

/**
 * Persistence for the route handlers, on PostgreSQL. Every statement is parameterised.
 * Multi-row changes run in one database transaction so the daily counters can never drift
 * from the rows they count. Committed changes are pushed to browsers via GET /api/stream.
 */

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 503,
  ) {
    super(message);
  }
}

export type StoreEvent =
  | { type: "transaction"; transaction: Transaction }
  | { type: "alert"; alert: Alert }
  | { type: "stats"; stats: DailyStats }
  | { type: "config"; config: Config };

export interface Snapshot {
  transactions: Transaction[]; // newest first
  alerts: Alert[];
  stats: DailyStats;
  config: Config;
}

type ActorWithId = Actor & { uid: string };

const SNAPSHOT_TRANSACTIONS = 1_000;
const SNAPSHOT_ALERTS = 500;
const CONFIG_MISSING =
  "The settings row is missing, so no threshold has been chosen. Run: cd web; npx tsx --env-file=.env.local scripts/seed-config.ts";

// ---- change notifications (in-process; one Next.js server) --------------------------------

const g = globalThis as typeof globalThis & { __fraudListeners?: Set<(e: StoreEvent) => void> };
const listeners = (g.__fraudListeners ??= new Set());

function emit(event: StoreEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // a broken stream must not affect writers
    }
  }
}

export function subscribe(listener: (e: StoreEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---- row mapping -------------------------------------------------------------------------------

function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTransaction(r: any): Transaction {
  return {
    id: r.id,
    externalId: r.id,
    time: r.time,
    amount: r.amount,
    v: r.v,
    ...(r.label !== null && { label: r.label as 0 | 1 }),
    probability: r.probability,
    riskLevel: r.risk_level,
    isAlert: r.is_alert,
    status: r.status,
    modelVersion: r.model_version,
    thresholdUsed: r.threshold_used,
    receivedAt: r.received_at.getTime(),
    latencyMs: r.latency_ms,
    shadowProbability: r.shadow_probability ?? null,
    shadowModelVersion: r.shadow_model_version ?? null,
  };
}

const ALERT_COLUMNS = `a.id, a.amount, a.probability, a.threshold_used, a.model_version, a.status, a.created_at,
  a.reviewed_at, a.note, u.email AS reviewed_by_email
  FROM alerts a LEFT JOIN users u ON u.id = a.reviewed_by`;

function toAlert(r: any): Alert {
  return {
    id: r.id,
    transactionId: r.id,
    amount: r.amount,
    probability: r.probability,
    thresholdUsed: r.threshold_used,
    modelVersion: r.model_version,
    status: r.status,
    createdAt: r.created_at.getTime(),
    reviewedBy: r.reviewed_by_email,
    reviewedAt: r.reviewed_at ? r.reviewed_at.getTime() : null,
    note: r.note,
  };
}

function toStats(r: any): DailyStats {
  return {
    date: r.day,
    total: r.total,
    alerts: r.alerts,
    open: r.open,
    confirmedFraud: r.confirmed_fraud,
    falsePositive: r.false_positive,
    scoringFailed: r.scoring_failed,
    latencySumMs: r.latency_sum_ms,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const emptyStats = (date: string): DailyStats => ({
  date,
  total: 0,
  alerts: 0,
  open: 0,
  confirmedFraud: 0,
  falsePositive: 0,
  scoringFailed: 0,
  latencySumMs: 0,
});

async function inTransaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function audit(
  c: PoolClient | ReturnType<typeof db>,
  entry: { actorId: string | null; actorEmail: string | null; role: Role | null; action: string; target?: string; before?: unknown; after?: unknown },
) {
  await c.query("INSERT INTO audit_logs (actor_id, actor_email, role, action, target, before, after) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    entry.actorId,
    entry.actorEmail,
    entry.role,
    entry.action,
    entry.target ?? null,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  ]);
}

// ---- configuration -----------------------------------------------------------------------------

export async function getConfig(): Promise<Config> {
  const { rows } = await db().query(
    `SELECT s.threshold, s.active_model_version, COALESCE(m.stub, false) AS stub
     FROM settings s LEFT JOIN model_versions m ON m.version = s.active_model_version WHERE s.id = 1`,
  );
  if (!rows[0]) throw new StoreError(CONFIG_MISSING, 503);
  return { threshold: rows[0].threshold, activeModelVersion: rows[0].active_model_version ?? "none", activeModelStub: rows[0].stub };
}

// Each server process holds its own ~5 s cache, so a threshold change made through another
// instance takes up to 5 s to apply there. This process clears it on its own changes.
let thresholdCache: { value: number; at: number } | null = null;

export async function getThreshold(): Promise<number> {
  if (thresholdCache && Date.now() - thresholdCache.at < 5_000) return thresholdCache.value;
  thresholdCache = { value: (await getConfig()).threshold, at: Date.now() };
  return thresholdCache.value;
}

/** The inference service is the authority on which model is serving; keep settings in step with it. */
export async function recordActiveModel(version: string, stub: boolean): Promise<void> {
  const { rowCount } = await inTransaction(async (c) => {
    await c.query("INSERT INTO model_versions (version, stub) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING", [version, stub]);
    return c.query("UPDATE settings SET active_model_version = $1, updated_at = now() WHERE id = 1 AND active_model_version IS DISTINCT FROM $1", [
      version,
    ]);
  });
  if (rowCount) emit({ type: "config", config: await getConfig() });
}

export async function setThreshold(threshold: number, actor: ActorWithId): Promise<Config> {
  await inTransaction(async (c) => {
    const { rows } = await c.query("SELECT threshold FROM settings WHERE id = 1 FOR UPDATE");
    if (!rows[0]) throw new StoreError(CONFIG_MISSING, 503);
    await c.query("UPDATE settings SET threshold = $1, updated_at = now() WHERE id = 1", [threshold]);
    await audit(c, {
      actorId: actor.uid,
      actorEmail: actor.email,
      role: actor.role,
      action: "config.threshold",
      target: "settings",
      before: { threshold: rows[0].threshold },
      after: { threshold },
    });
  });
  thresholdCache = null;
  const config = await getConfig();
  emit({ type: "config", config });
  return config;
}

// ---- ingestion ---------------------------------------------------------------------------------

/** The subset of `ids` already stored — checked before scoring so duplicates cost no inference. */
export async function existingTransactionIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await db().query<{ id: string }>("SELECT id FROM transactions WHERE id = ANY($1)", [ids]);
  return new Set(rows.map((r) => r.id));
}

export interface IngestOutcome {
  committed: Transaction[];
  duplicates: string[]; // ids already stored (or repeated within the batch); nothing written for them
}

/**
 * Transactions + alerts (if high risk; alert id = transaction id) + daily counters, all in ONE
 * database transaction. A duplicate id is skipped (ON CONFLICT DO NOTHING) rather than failing
 * the batch, so the counters only ever count rows that were actually inserted.
 */
export async function commitIngestBatch(txs: Transaction[]): Promise<IngestOutcome> {
  const committed: Transaction[] = [];
  const duplicates: string[] = [];
  const alerts: Alert[] = [];

  const stats = await inTransaction(async (c) => {
    const perDay = new Map<string, { total: number; alerts: number; failed: number; latency: number }>();
    for (const tx of txs) {
      const receivedAt = new Date(tx.receivedAt);
      const { rowCount } = await c.query(
        `INSERT INTO transactions (id, time, amount, v, label, probability, risk_level, is_alert, status, model_version,
           threshold_used, received_at, latency_ms, shadow_probability, shadow_model_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO NOTHING`,
        [
          tx.id,
          tx.time,
          tx.amount,
          tx.v,
          tx.label ?? null,
          tx.probability,
          tx.riskLevel,
          tx.isAlert,
          tx.status,
          tx.modelVersion,
          tx.thresholdUsed,
          receivedAt,
          tx.latencyMs,
          tx.shadowProbability,
          tx.shadowModelVersion,
        ],
      );
      if (!rowCount) {
        duplicates.push(tx.id);
        continue;
      }
      committed.push(tx);

      const raised = tx.isAlert && tx.probability !== null && tx.modelVersion !== null;
      if (raised) {
        await c.query(
          `INSERT INTO alerts (id, amount, probability, threshold_used, model_version, status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'open', $6)`,
          [tx.id, tx.amount, tx.probability, tx.thresholdUsed, tx.modelVersion, receivedAt],
        );
        alerts.push({
          id: tx.id,
          transactionId: tx.id,
          amount: tx.amount,
          probability: tx.probability as number,
          thresholdUsed: tx.thresholdUsed,
          modelVersion: tx.modelVersion as string,
          status: "open",
          createdAt: tx.receivedAt,
          reviewedBy: null,
          reviewedAt: null,
          note: null,
        });
      }
      const day = dayKey(tx.receivedAt);
      const d = perDay.get(day) ?? { total: 0, alerts: 0, failed: 0, latency: 0 };
      d.total += 1;
      d.alerts += raised ? 1 : 0;
      d.failed += tx.status === "scoring_failed" ? 1 : 0;
      d.latency += tx.latencyMs;
      perDay.set(day, d);
    }

    const updated: DailyStats[] = [];
    for (const [day, d] of perDay) {
      const { rows } = await c.query(
        `INSERT INTO daily_stats (day, total, alerts, open, scoring_failed, latency_sum_ms) VALUES ($1, $2, $3, $3, $4, $5)
         ON CONFLICT (day) DO UPDATE SET
           total = daily_stats.total + EXCLUDED.total,
           alerts = daily_stats.alerts + EXCLUDED.alerts,
           open = daily_stats.open + EXCLUDED.open,
           scoring_failed = daily_stats.scoring_failed + EXCLUDED.scoring_failed,
           latency_sum_ms = daily_stats.latency_sum_ms + EXCLUDED.latency_sum_ms
         RETURNING *`,
        [day, d.total, d.alerts, d.failed, d.latency],
      );
      updated.push(toStats(rows[0]));
    }
    return updated;
  });

  for (const transaction of committed) emit({ type: "transaction", transaction });
  for (const alert of alerts) emit({ type: "alert", alert });
  for (const s of stats) emit({ type: "stats", stats: s });
  return { committed, duplicates };
}

/** One transaction; a duplicate id is a 409. */
export async function commitIngest(tx: Transaction): Promise<void> {
  const { duplicates } = await commitIngestBatch([tx]);
  if (duplicates.length > 0) throw new StoreError("Duplicate transaction ID.", 409);
}

// ---- alert review --------------------------------------------------------------------------------

// Fixed map — column names are never taken from input.
const COUNTER: Record<AlertStatus, string> = { open: "open", confirmed_fraud: "confirmed_fraud", false_positive: "false_positive" };

/**
 * Alert update + counter move + audit entry in ONE database transaction, with the alert row
 * locked, so concurrent reviews serialise and the counters always match the alerts.
 * Analysts may act only on open alerts; admins may change a decision.
 */
export async function reviewAlert(id: string, decision: Decision, note: string | undefined, actor: ActorWithId): Promise<Alert> {
  const stats = await inTransaction(async (c) => {
    const { rows } = await c.query("SELECT status, created_at, note FROM alerts WHERE id = $1 FOR UPDATE", [id]);
    const current = rows[0];
    if (!current) throw new StoreError("Alert not found.", 404);
    if (current.status !== "open" && actor.role !== "admin") {
      throw new StoreError("This alert has already been reviewed. Only an admin can change the decision.", 403);
    }
    if (current.status === decision) throw new StoreError("The alert already has this decision.", 409);

    const newNote = note?.trim() || null;
    await c.query("UPDATE alerts SET status = $2, reviewed_by = $3, reviewed_at = now(), note = $4 WHERE id = $1", [id, decision, actor.uid, newNote]);
    const from = COUNTER[current.status as AlertStatus];
    const to = COUNTER[decision];
    const { rows: statRows } = await c.query(`UPDATE daily_stats SET ${from} = ${from} - 1, ${to} = ${to} + 1 WHERE day = $1 RETURNING *`, [
      dayKey(current.created_at.getTime()),
    ]);
    await audit(c, {
      actorId: actor.uid,
      actorEmail: actor.email,
      role: actor.role,
      action: "alert.review",
      target: `alerts/${id}`,
      before: { status: current.status, note: current.note },
      after: { status: decision, note: newNote },
    });
    return statRows[0] ? toStats(statRows[0]) : null;
  });

  const { rows } = await db().query(`SELECT ${ALERT_COLUMNS} WHERE a.id = $1`, [id]);
  const updated = toAlert(rows[0]);
  emit({ type: "alert", alert: updated });
  if (stats) emit({ type: "stats", stats });
  return updated;
}

// ---- users and audit -------------------------------------------------------------------------------

export interface UserForLogin {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  passwordHash: string;
}

export async function findUserByEmail(email: string): Promise<UserForLogin | null> {
  const { rows } = await db().query("SELECT id, email, role, active, password_hash FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  const r = rows[0];
  return r ? { id: r.id, email: r.email, role: r.role, active: r.active, passwordHash: r.password_hash } : null;
}

export async function recordAudit(entry: {
  actorId: string | null;
  actorEmail: string | null;
  role: Role | null;
  action: string;
  target?: string;
  after?: unknown;
}): Promise<void> {
  await audit(db(), entry);
}

export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await db().query(
    `SELECT u.id, u.email, u.role, u.active, u.created_at,
       (SELECT max(l.at) FROM audit_logs l WHERE l.actor_id = u.id AND l.action = 'auth.login') AS last_login_at
     FROM users u ORDER BY u.created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    active: r.active,
    createdAt: r.created_at.getTime(),
    lastLoginAt: r.last_login_at ? r.last_login_at.getTime() : null,
  }));
}

/** The caller hashes the password; this module never sees it in plain text. */
export async function createUser(input: { email: string; role: Role; passwordHash: string }, actor: ActorWithId): Promise<string> {
  try {
    return await inTransaction(async (c) => {
      const { rows } = await c.query("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id", [
        input.email,
        input.passwordHash,
        input.role,
      ]);
      await audit(c, {
        actorId: actor.uid,
        actorEmail: actor.email,
        role: actor.role,
        action: "user.create",
        target: `users/${rows[0].id}`,
        after: { email: input.email, role: input.role },
      });
      return rows[0].id as string;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new StoreError("A user with this email already exists.", 409);
    throw e;
  }
}

/**
 * Role, active flag and/or password, with an audit entry. Refuses anything that would leave the
 * system without an active admin, and an admin removing their own access. Active admin rows are
 * locked first, so two admins demoting each other at the same moment cannot both succeed.
 */
export async function updateUser(id: string, changes: { role?: Role; active?: boolean; passwordHash?: string }, actor: ActorWithId): Promise<void> {
  await inTransaction(async (c) => {
    const { rows: admins } = await c.query("SELECT id FROM users WHERE role = 'admin' AND active ORDER BY id FOR UPDATE");
    const { rows } = await c.query("SELECT email, role, active FROM users WHERE id = $1 FOR UPDATE", [id]);
    const current = rows[0];
    if (!current) throw new StoreError("User not found.", 404);

    const role: Role = changes.role ?? current.role;
    const active: boolean = changes.active ?? current.active;
    const losesAdmin = current.role === "admin" && current.active && (role !== "admin" || !active);
    if (losesAdmin && id === actor.uid) throw new StoreError("You can't remove your own admin access. Ask another admin.", 403);
    if (losesAdmin && admins.length <= 1) throw new StoreError("This is the last active admin. Promote someone else first.", 409);

    await c.query("UPDATE users SET role = $2, active = $3, password_hash = COALESCE($4, password_hash) WHERE id = $1", [
      id,
      role,
      active,
      changes.passwordHash ?? null,
    ]);
    await audit(c, {
      actorId: actor.uid,
      actorEmail: actor.email,
      role: actor.role,
      action: "user.update",
      target: `users/${id}`,
      before: { email: current.email, role: current.role, active: current.active },
      after: { email: current.email, role, active, ...(changes.passwordHash && { passwordReset: true }) },
    });
  });
}

export async function listAudit(q: { action?: string; actor?: string; beforeId?: number; limit: number }): Promise<AuditEntry[]> {
  const { rows } = await db().query(
    `SELECT id, at, actor_email, role, action, target, before, after FROM audit_logs
     WHERE ($1::text IS NULL OR action = $1)
       AND ($2::text IS NULL OR position(lower($2) IN lower(coalesce(actor_email, ''))) > 0)
       AND ($3::bigint IS NULL OR id < $3)
     ORDER BY id DESC LIMIT $4`,
    [q.action ?? null, q.actor ?? null, q.beforeId ?? null, q.limit],
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at.getTime(),
    actorEmail: r.actor_email,
    role: r.role,
    action: r.action,
    target: r.target,
    before: r.before,
    after: r.after,
  }));
}

export async function listAuditActions(): Promise<string[]> {
  const { rows } = await db().query<{ action: string }>("SELECT DISTINCT action FROM audit_logs ORDER BY action");
  return rows.map((r) => r.action);
}

// ---- reports -----------------------------------------------------------------------------------------

export interface LabelCounts {
  n: number;
  positives: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

// Confusion counts from the stored decisions: is_alert already reflects each row's own threshold.
const LABEL_COUNTS = `count(*)::int AS n,
  count(*) FILTER (WHERE label = 1)::int AS positives,
  count(*) FILTER (WHERE label = 1 AND is_alert)::int AS tp,
  count(*) FILTER (WHERE label = 0 AND is_alert)::int AS fp,
  count(*) FILTER (WHERE label = 1 AND NOT is_alert)::int AS fn,
  count(*) FILTER (WHERE label = 0 AND NOT is_alert)::int AS tn`;

export interface ReportData {
  days: DailyStats[];
  amounts: { day: string; alertAmount: number; confirmedFraudAmount: number }[];
  avgReviewMinutes: number | null;
  labelled: LabelCounts;
  topAlerts: Alert[];
}

/** Everything for a report over [from, to] (inclusive local days). Counts come from daily_stats. */
export async function getReportData(from: string, to: string): Promise<ReportData> {
  const range = "BETWEEN $1::date AND $2::date";
  const [days, amounts, review, labelled, top] = await Promise.all([
    db().query(`SELECT * FROM daily_stats WHERE day ${range} ORDER BY day`, [from, to]),
    db().query(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, sum(amount) AS alert_amount,
         coalesce(sum(amount) FILTER (WHERE status = 'confirmed_fraud'), 0) AS confirmed_amount
       FROM alerts WHERE created_at::date ${range} GROUP BY 1`,
      [from, to],
    ),
    db().query(
      `SELECT avg(extract(epoch FROM reviewed_at - created_at)) / 60 AS minutes
       FROM alerts WHERE status <> 'open' AND created_at::date ${range}`,
      [from, to],
    ),
    db().query(`SELECT ${LABEL_COUNTS} FROM transactions WHERE status = 'scored' AND label IS NOT NULL AND received_at::date ${range}`, [
      from,
      to,
    ]),
    db().query(`SELECT ${ALERT_COLUMNS} WHERE a.created_at::date ${range} ORDER BY a.probability DESC, a.created_at DESC LIMIT 10`, [from, to]),
  ]);
  return {
    days: days.rows.map(toStats),
    amounts: amounts.rows.map((r) => ({ day: r.day, alertAmount: r.alert_amount, confirmedFraudAmount: r.confirmed_amount })),
    avgReviewMinutes: review.rows[0].minutes === null ? null : Number(review.rows[0].minutes),
    labelled: labelled.rows[0],
    topAlerts: top.rows.map(toAlert),
  };
}

export interface FeedbackRow {
  id: string;
  time: number;
  v: number[];
  amount: number;
  decision: Decision;
  reviewedAt: number;
  modelVersion: string;
  datasetLabel: 0 | 1 | null;
}

/** Every reviewed alert with its features — analyst decisions as labels for retraining. */
export async function listFeedback(): Promise<FeedbackRow[]> {
  const { rows } = await db().query(
    `SELECT t.id, t.time, t.v, t.amount, a.status, a.reviewed_at, a.model_version, t.label
     FROM alerts a JOIN transactions t ON t.id = a.id WHERE a.status <> 'open' ORDER BY a.reviewed_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    time: r.time,
    v: r.v,
    amount: r.amount,
    decision: r.status,
    reviewedAt: r.reviewed_at.getTime(),
    modelVersion: r.model_version,
    datasetLabel: r.label,
  }));
}

// ---- model monitoring --------------------------------------------------------------------------------

export async function getModelInfo(version: string): Promise<{ suggestedThreshold: number | null; metrics: unknown }> {
  const { rows } = await db().query("SELECT suggested_threshold, metrics FROM model_versions WHERE version = $1", [version]);
  return { suggestedThreshold: rows[0]?.suggested_threshold ?? null, metrics: rows[0]?.metrics ?? null };
}

export interface LabelledScore {
  probability: number;
  label: 0 | 1;
  amount: number;
}

/** The model's most recent scored transactions that carry an evaluation label. */
export async function getLabelledScores(modelVersion: string, limit = 50_000): Promise<LabelledScore[]> {
  const { rows } = await db().query(
    `SELECT probability, label, amount FROM transactions
     WHERE model_version = $1 AND status = 'scored' AND label IS NOT NULL ORDER BY received_at DESC LIMIT $2`,
    [modelVersion, limit],
  );
  return rows;
}

export async function getReviewCounts(modelVersion: string): Promise<Record<AlertStatus, number>> {
  const { rows } = await db().query("SELECT status, count(*)::int AS n FROM alerts WHERE model_version = $1 GROUP BY status", [modelVersion]);
  const counts: Record<AlertStatus, number> = { open: 0, confirmed_fraud: 0, false_positive: 0 };
  for (const r of rows) counts[r.status as AlertStatus] = r.n;
  return counts;
}

export interface ScoredRow {
  probability: number;
  amount: number;
  v: number[];
  receivedAt: number;
}

/**
 * Two windows of the model's scored traffic for drift: the first `size` rows it ever scored
 * (reference) and the latest `size` (current). With fewer than 2 × size rows the history is
 * split in half, so the windows never overlap.
 */
export async function getDriftWindows(modelVersion: string, size: number): Promise<{ reference: ScoredRow[]; current: ScoredRow[] }> {
  const { rows: count } = await db().query("SELECT count(*)::int AS n FROM transactions WHERE model_version = $1 AND status = 'scored'", [
    modelVersion,
  ]);
  const n = Math.min(size, Math.floor(count[0].n / 2));
  if (n === 0) return { reference: [], current: [] };
  const window = (order: "ASC" | "DESC") =>
    db().query(
      `SELECT probability, amount, v, received_at FROM transactions
       WHERE model_version = $1 AND status = 'scored' ORDER BY received_at ${order}, id ${order} LIMIT $2`,
      [modelVersion, n],
    );
  const [ref, cur] = await Promise.all([window("ASC"), window("DESC")]);
  const toRow = (r: { probability: number; amount: number; v: number[]; received_at: Date }): ScoredRow => ({
    probability: r.probability,
    amount: r.amount,
    v: r.v,
    receivedAt: r.received_at.getTime(),
  });
  return { reference: ref.rows.map(toRow), current: cur.rows.map(toRow).reverse() };
}

export interface ShadowRow {
  probability: number;
  shadowProbability: number;
  shadowModelVersion: string;
  label: 0 | 1 | null;
}

/** Recent transactions the active model scored with a shadow alongside — newest shadow model only. */
export async function getShadowRows(modelVersion: string, limit = 20_000): Promise<ShadowRow[]> {
  const { rows } = await db().query(
    `WITH latest AS (
       SELECT shadow_model_version FROM transactions
       WHERE model_version = $1 AND shadow_model_version IS NOT NULL ORDER BY received_at DESC LIMIT 1)
     SELECT t.probability, t.shadow_probability, t.shadow_model_version, t.label FROM transactions t, latest
     WHERE t.model_version = $1 AND t.shadow_model_version = latest.shadow_model_version
     ORDER BY t.received_at DESC LIMIT $2`,
    [modelVersion, limit],
  );
  return rows.map((r) => ({ probability: r.probability, shadowProbability: r.shadow_probability, shadowModelVersion: r.shadow_model_version, label: r.label }));
}

// ---- explanations ------------------------------------------------------------------------------------

export async function getExplanationInput(
  id: string,
): Promise<{ modelVersion: string; explanation: Explanation | null; time: number; amount: number; v: number[] } | null> {
  const { rows } = await db().query(
    "SELECT a.model_version, a.explanation, t.time, t.amount, t.v FROM alerts a JOIN transactions t ON t.id = a.id WHERE a.id = $1",
    [id],
  );
  const r = rows[0];
  return r ? { modelVersion: r.model_version, explanation: r.explanation, time: r.time, amount: r.amount, v: r.v } : null;
}

/** Cached once. The caller saves only explanations from the model that scored the alert. */
export async function saveExplanation(id: string, explanation: Explanation): Promise<void> {
  await db().query("UPDATE alerts SET explanation = $2 WHERE id = $1 AND explanation IS NULL", [id, JSON.stringify(explanation)]);
}

// ---- snapshot for the live stream ------------------------------------------------------------------

export async function getSnapshot(): Promise<Snapshot> {
  const today = dayKey(Date.now());
  const [recent, alerts, stats, config] = await Promise.all([
    db().query("SELECT * FROM transactions ORDER BY received_at DESC LIMIT $1", [SNAPSHOT_TRANSACTIONS]),
    db().query(`SELECT ${ALERT_COLUMNS} ORDER BY a.created_at DESC LIMIT $1`, [SNAPSHOT_ALERTS]),
    db().query("SELECT * FROM daily_stats WHERE day = $1", [today]),
    getConfig(),
  ]);
  const transactions = recent.rows.map(toTransaction);
  // Alert detail pages need each alert's transaction even when it is older than the recent window.
  const have = new Set(transactions.map((t) => t.id));
  const missing = alerts.rows.map((a) => a.id as string).filter((id) => !have.has(id));
  if (missing.length > 0) {
    const older = await db().query("SELECT * FROM transactions WHERE id = ANY($1)", [missing]);
    transactions.push(...older.rows.map(toTransaction));
  }
  return {
    transactions: transactions.sort((a, b) => b.receivedAt - a.receivedAt),
    alerts: alerts.rows.map(toAlert),
    stats: stats.rows[0] ? toStats(stats.rows[0]) : emptyStats(today),
    config,
  };
}
