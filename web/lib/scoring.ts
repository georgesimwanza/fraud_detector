import "server-only";
import type { Explanation, TransactionIn } from "./schemas";

// 800 ms for one transaction (NFR1); a batch gets a little more per row, capped.
const timeoutFor = (n: number) => Math.min(5_000, 800 + 4 * (n - 1));
const EXPLAIN_TIMEOUT_MS = 5_000;

export interface ScoreResult {
  probabilities: number[]; // same order as the input
  modelVersion: string;
  stub: boolean;
  inferenceMs: number;
  shadow: { modelVersion: string; probabilities: number[] } | null;
}

export class ScoringError extends Error {}

const isProbability = (p: unknown): p is number => typeof p === "number" && p >= 0 && p <= 1;

async function call(path: string, body: unknown, timeoutMs: number) {
  const url = process.env.INFERENCE_URL;
  const key = process.env.INFERENCE_INTERNAL_KEY;
  if (!url || !key) throw new ScoringError("INFERENCE_URL / INFERENCE_INTERNAL_KEY not set");

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new ScoringError(timedOut ? `inference timed out after ${timeoutMs} ms` : "inference service unreachable");
  }
  if (!res.ok) throw new ScoringError(`inference returned HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json || typeof json.model_version !== "string") throw new ScoringError("inference returned a malformed response");
  return json;
}

/** Scores transactions in one inference call. Labels are never sent. */
export async function score(txs: TransactionIn[]): Promise<ScoreResult> {
  const body = await call("/predict", { transactions: txs.map(({ time, amount, v }) => ({ time, amount, v })) }, timeoutFor(txs.length));
  const probs: unknown = body.probabilities;
  if (!Array.isArray(probs) || probs.length !== txs.length || !probs.every(isProbability)) {
    throw new ScoringError("inference returned a malformed response");
  }
  // A malformed shadow block is dropped, not fatal: the challenger never decides anything.
  const s = body.shadow;
  const shadowOk = s && typeof s.model_version === "string" && Array.isArray(s.probabilities) && s.probabilities.length === txs.length && s.probabilities.every(isProbability);
  return {
    probabilities: probs,
    modelVersion: body.model_version,
    stub: body.stub === true,
    inferenceMs: Number(body.latency_ms) || 0,
    shadow: shadowOk ? { modelVersion: s.model_version, probabilities: s.probabilities } : null,
  };
}

/** Per-feature attributions for one transaction, from the model the inference service is serving now. */
export async function explain(tx: Pick<TransactionIn, "time" | "amount" | "v">): Promise<Explanation> {
  const body = await call("/explain", { transaction: { time: tx.time, amount: tx.amount, v: tx.v } }, EXPLAIN_TIMEOUT_MS);
  if (!Array.isArray(body.attributions) || !isProbability(body.probability)) throw new ScoringError("inference returned a malformed explanation");
  return {
    method: "integrated_gradients",
    modelVersion: body.model_version,
    probability: body.probability,
    baselineProbability: body.baseline_probability,
    residual: body.residual,
    attributions: body.attributions.map((a: { feature: string; value: number; attribution: number }) => ({
      feature: a.feature,
      value: a.value,
      attribution: a.attribution,
    })),
  };
}
