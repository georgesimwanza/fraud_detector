import { NextResponse } from "next/server";
import { verifyIngestKey } from "@/lib/ingest-auth";
import { log } from "@/lib/log";
import { BatchInSchema, MAX_BATCH } from "@/lib/schemas";
import { ingest } from "../ingest";

/**
 * NFR1 batch processing: up to MAX_BATCH transactions, scored in ONE inference call and stored in
 * ONE database transaction. Each record gets its own result; an invalid or duplicate record is
 * reported and skipped without affecting the others (NFR5).
 *
 * 200 → { summary, results: [{ index, id, status: scored | scoring_failed | duplicate | invalid, … }] }
 * 400 → the envelope itself is wrong (not an object with 1–MAX_BATCH transactions)
 */
export async function POST(req: Request) {
  const started = performance.now();
  if (!verifyIngestKey(req.headers.get("x-api-key"))) {
    log("warn", "ingest_unauthorized", { batch: true });
    return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
  }

  const envelope = BatchInSchema.safeParse(await req.json().catch(() => undefined));
  if (!envelope.success) {
    return NextResponse.json({ error: `Body must be {"transactions": [...]} with 1–${MAX_BATCH} transactions.` }, { status: 400 });
  }

  const outcome = await ingest(envelope.data.transactions, started);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error.message }, { status: outcome.error.status });

  const summary = { received: outcome.results.length, scored: 0, alerts: 0, scoring_failed: 0, duplicate: 0, invalid: 0 };
  for (const r of outcome.results) {
    summary[r.status] += 1;
    if (r.status === "scored" && r.isAlert) summary.alerts += 1;
  }
  const latencyMs = Math.round(performance.now() - started);
  log("info", "ingested_batch", { ...summary, latencyMs });
  return NextResponse.json({ summary, latencyMs, results: outcome.results });
}
