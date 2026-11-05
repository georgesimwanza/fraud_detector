import "server-only";
import { randomUUID } from "node:crypto";
import { log } from "@/lib/log";
import { TransactionInSchema, isHighRisk, type RiskLevel, type Transaction, type TransactionIn } from "@/lib/schemas";
import { ScoringError, score, type ScoreResult } from "@/lib/scoring";
import { StoreError, commitIngestBatch, existingTransactionIds, getThreshold, recordActiveModel } from "@/lib/store";

/**
 * The ingest pipeline shared by POST /api/transactions and POST /api/transactions/batch:
 * validate each record -> dedupe -> threshold -> score (one inference call) -> classify -> persist (one write).
 * Lives beside the routes, not in lib/, because it coordinates several lib modules.
 */

export type ItemResult =
  | { index: number; id: string; status: "scored"; probability: number; riskLevel: RiskLevel; isAlert: boolean; thresholdUsed: number; modelVersion: string; latencyMs: number }
  | { index: number; id: string; status: "scoring_failed"; error: string; latencyMs: number }
  | { index: number; id: string; status: "duplicate" }
  | { index: number; id?: string; status: "invalid"; issues: { field: string; message: string }[] };

export type IngestResult = { ok: true; results: ItemResult[] } | { ok: false; error: StoreError };

export async function ingest(records: unknown[], started: number): Promise<IngestResult> {
  const results: ItemResult[] = new Array(records.length);
  const accepted: { index: number; id: string; input: TransactionIn }[] = [];
  const seen = new Set<string>();

  // 1. Contract, record by record. A bad record is reported and skipped; the rest carry on (NFR5).
  records.forEach((record, index) => {
    const parsed = TransactionInSchema.safeParse(record);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(body)", message: i.message }));
      results[index] = { index, status: "invalid", issues };
      return;
    }
    const id = parsed.data.externalId ?? `tx-${randomUUID()}`;
    if (seen.has(id)) {
      results[index] = { index, id, status: "duplicate" };
      return;
    }
    seen.add(id);
    accepted.push({ index, id, input: parsed.data });
  });

  // 2. Already stored? Then it costs no inference.
  const existing = await existingTransactionIds(accepted.map((a) => a.id));
  const fresh = accepted.filter((a) => {
    if (existing.has(a.id)) results[a.index] = { index: a.index, id: a.id, status: "duplicate" };
    return !existing.has(a.id);
  });
  if (fresh.length === 0) return { ok: true, results };

  // 3. Threshold (cached ~5 s). Never fall back to a default: nobody chose it.
  let threshold: number;
  try {
    threshold = await getThreshold();
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    log("error", "config_missing", { message: e.message });
    return { ok: false, error: e };
  }

  // 4. Score every fresh record in one call. A failure is stored, never dropped.
  let scored: ScoreResult | null = null;
  let failure = "";
  try {
    scored = await score(fresh.map((a) => a.input));
  } catch (e) {
    failure = e instanceof ScoringError ? e.message : "unexpected scoring error";
    log("warn", "scoring_failed", { n: fresh.length, reason: failure });
  }

  // 5. Classify (FR6: isHighRisk is the only comparison).
  const receivedAt = Date.now();
  const latencyMs = Math.round(performance.now() - started); // receipt -> decision
  const txs: Transaction[] = fresh.map(({ id, input }, i) => {
    const probability = scored ? scored.probabilities[i] : null;
    const isAlert = probability !== null && isHighRisk(probability, threshold);
    return {
      id,
      externalId: id,
      time: input.time,
      amount: input.amount,
      v: input.v,
      ...(input.label !== undefined && { label: input.label }),
      probability,
      riskLevel: probability === null ? null : isAlert ? "high" : "low",
      isAlert,
      status: scored ? "scored" : "scoring_failed",
      modelVersion: scored?.modelVersion ?? null,
      thresholdUsed: threshold,
      receivedAt,
      latencyMs,
      shadowProbability: scored?.shadow?.probabilities[i] ?? null,
      shadowModelVersion: scored?.shadow ? scored.shadow.modelVersion : null,
    };
  });

  // 6. One write: transactions + alerts + daily stats.
  try {
    if (scored) await recordActiveModel(scored.modelVersion, scored.stub);
    const { duplicates } = await commitIngestBatch(txs);
    const raced = new Set(duplicates); // inserted by a concurrent request since step 2
    fresh.forEach(({ index, id }, i) => {
      const tx = txs[i];
      if (raced.has(id)) results[index] = { index, id, status: "duplicate" };
      else if (tx.status === "scoring_failed") results[index] = { index, id, status: "scoring_failed", error: failure, latencyMs: tx.latencyMs };
      else
        results[index] = {
          index,
          id,
          status: "scored",
          probability: tx.probability as number,
          riskLevel: tx.riskLevel as RiskLevel,
          isAlert: tx.isAlert,
          thresholdUsed: threshold,
          modelVersion: tx.modelVersion as string,
          latencyMs: tx.latencyMs,
        };
    });
  } catch (e) {
    if (e instanceof StoreError) return { ok: false, error: e };
    throw e;
  }
  return { ok: true, results };
}
