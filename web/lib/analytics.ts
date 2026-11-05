import "server-only";
import {
  FEATURE_ORDER,
  isHighRisk,
  type AlertStatus,
  type CurvePoint,
  type DailyStats,
  type DriftLevel,
  type DriftReport,
  type FeatureDrift,
  type Performance,
  type Report,
  type ReportDay,
  type ReviewFeedback,
  type ShadowComparison,
  type Alert,
} from "./schemas";

/**
 * Pure calculations for reports and model monitoring. No I/O: route handlers fetch rows from
 * lib/store.ts and pass them in, so every function here is unit-tested without a database.
 */

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export function performance(c: { tp: number; fp: number; fn: number; tn: number }): Performance {
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { n: c.tp + c.fp + c.fn + c.tn, positives: c.tp + c.fn, tp: c.tp, fp: c.fp, fn: c.fn, tn: c.tn, precision, recall, f1 };
}

/** Confusion counts for `scores` judged at `threshold`. */
export function performanceAt(scores: { probability: number; label: 0 | 1 }[], threshold: number): Performance {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const s of scores) {
    const flagged = isHighRisk(s.probability, threshold);
    if (s.label === 1) c[flagged ? "tp" : "fn"] += 1;
    else c[flagged ? "fp" : "tn"] += 1;
  }
  return performance(c);
}

export const CURVE_THRESHOLDS = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);

/** Confusion counts and missed-fraud value at every threshold 0.01 … 0.99 (the settable range). */
export function thresholdCurve(scores: { probability: number; label: 0 | 1; amount: number }[]): CurvePoint[] {
  return CURVE_THRESHOLDS.map((threshold) => {
    const p: CurvePoint = { threshold, tp: 0, fp: 0, fn: 0, tn: 0, missedFraudAmount: 0 };
    for (const s of scores) {
      const flagged = isHighRisk(s.probability, threshold);
      if (s.label === 1) {
        if (flagged) p.tp += 1;
        else {
          p.fn += 1;
          p.missedFraudAmount += s.amount;
        }
      } else if (flagged) p.fp += 1;
      else p.tn += 1;
    }
    return p;
  });
}

export function reviewFeedback(counts: Record<AlertStatus, number>): ReviewFeedback {
  const reviewed = counts.confirmed_fraud + counts.false_positive;
  return { reviewed, confirmedFraud: counts.confirmed_fraud, falsePositive: counts.false_positive, precision: ratio(counts.confirmed_fraud, reviewed) };
}

// ---- drift (Population Stability Index) ------------------------------------------------------------

const PSI_BINS = 10;
const PSI_FLOOR = 1e-4; // an empty bin would make ln(0); the conventional small floor
export const MIN_DRIFT_WINDOW = 100;

export function driftLevel(psi: number): DriftLevel {
  return psi < 0.1 ? "stable" : psi < 0.25 ? "moderate" : "significant";
}

/**
 * Upper bin edges at the reference's deciles plus its maximum, de-duplicated. Heavily tied data
 * gives fewer bins; the extra bin above the maximum catches values the reference never reached,
 * so even a constant reference can register drift.
 */
function cutPoints(reference: number[]): number[] {
  const sorted = [...reference].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let i = 1; i <= PSI_BINS; i++) {
    const q = sorted[Math.min(sorted.length - 1, Math.floor((i * sorted.length) / PSI_BINS))];
    if (cuts.length === 0 || q > cuts[cuts.length - 1]) cuts.push(q);
  }
  return cuts;
}

function binShares(values: number[], cuts: number[]): number[] {
  const counts = new Array(cuts.length + 1).fill(0);
  for (const v of values) {
    let bin = 0; // bins are (cut[i-1], cut[i]]
    while (bin < cuts.length && v > cuts[bin]) bin += 1;
    counts[bin] += 1;
  }
  return counts.map((c) => Math.max(c / values.length, PSI_FLOOR));
}

/** PSI = Σ (current% − reference%) · ln(current% / reference%), over reference-decile bins. */
export function psi(reference: number[], current: number[]): number {
  if (reference.length === 0 || current.length === 0) return 0;
  const cuts = cutPoints(reference);
  const r = binShares(reference, cuts);
  const c = binShares(current, cuts);
  return r.reduce((sum, ri, i) => sum + (c[i] - ri) * Math.log(c[i] / ri), 0);
}

interface Row {
  probability: number;
  amount: number;
  v: number[];
  receivedAt: number;
}

/**
 * Drift of the model's inputs and output between its first scored traffic and its latest.
 * Time is left out: in a replay it only ever grows, so it would always look drifted.
 */
export function driftReport(modelVersion: string, reference: Row[], current: Row[]): DriftReport {
  const enough = Math.min(reference.length, current.length) >= MIN_DRIFT_WINDOW;
  const feature = (name: string, pick: (r: Row) => number): FeatureDrift => {
    const value = psi(reference.map(pick), current.map(pick));
    return { feature: name, psi: value, level: driftLevel(value) };
  };
  const inputs = FEATURE_ORDER.filter((f) => f !== "Time").map((name) =>
    name === "Amount" ? feature(name, (r) => r.amount) : feature(name, (r) => r.v[Number(name.slice(1)) - 1]),
  );
  return {
    modelVersion,
    referenceFrom: reference[0]?.receivedAt ?? null,
    referenceTo: reference.at(-1)?.receivedAt ?? null,
    currentFrom: current[0]?.receivedAt ?? null,
    currentTo: current.at(-1)?.receivedAt ?? null,
    windowSize: Math.min(reference.length, current.length),
    score: enough ? feature("Fraud probability", (r) => r.probability) : null,
    features: enough ? inputs.sort((a, b) => b.psi - a.psi) : [],
  };
}

// ---- champion / challenger --------------------------------------------------------------------------

export function shadowComparison(
  activeModelVersion: string,
  rows: { probability: number; shadowProbability: number; shadowModelVersion: string; label: 0 | 1 | null }[],
  threshold: number,
): ShadowComparison | null {
  if (rows.length === 0) return null;
  let agree = 0;
  let activeAlerts = 0;
  let shadowAlerts = 0;
  let absDiff = 0;
  for (const r of rows) {
    const a = isHighRisk(r.probability, threshold);
    const s = isHighRisk(r.shadowProbability, threshold);
    if (a === s) agree += 1;
    if (a) activeAlerts += 1;
    if (s) shadowAlerts += 1;
    absDiff += Math.abs(r.probability - r.shadowProbability);
  }
  const labelled = rows.filter((r): r is typeof r & { label: 0 | 1 } => r.label !== null);
  return {
    activeModelVersion,
    shadowModelVersion: rows[0].shadowModelVersion,
    n: rows.length,
    threshold,
    agreement: agree / rows.length,
    activeAlerts,
    shadowAlerts,
    meanAbsDifference: absDiff / rows.length,
    active: performanceAt(labelled, threshold),
    shadow: performanceAt(
      labelled.map((r) => ({ probability: r.shadowProbability, label: r.label })),
      threshold,
    ),
  };
}

// ---- reports -----------------------------------------------------------------------------------------

/** Every calendar day from `from` to `to` inclusive (YYYY-MM-DD; computed in UTC so DST can't skip a day). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const emptyDay = (date: string): ReportDay => ({
  date,
  total: 0,
  alerts: 0,
  open: 0,
  confirmedFraud: 0,
  falsePositive: 0,
  scoringFailed: 0,
  latencySumMs: 0,
  alertAmount: 0,
  confirmedFraudAmount: 0,
});

export function buildReport(
  from: string,
  to: string,
  data: {
    days: DailyStats[];
    amounts: { day: string; alertAmount: number; confirmedFraudAmount: number }[];
    avgReviewMinutes: number | null;
    labelled: { tp: number; fp: number; fn: number; tn: number };
    topAlerts: Alert[];
  },
): Report {
  const stats = new Map(data.days.map((d) => [d.date, d]));
  const amounts = new Map(data.amounts.map((a) => [a.day, a]));
  const days = daysBetween(from, to).map((date) => ({
    ...emptyDay(date),
    ...stats.get(date),
    alertAmount: amounts.get(date)?.alertAmount ?? 0,
    confirmedFraudAmount: amounts.get(date)?.confirmedFraudAmount ?? 0,
  }));
  const totals = days.reduce((t, d) => {
    for (const k of Object.keys(t) as (keyof ReportDay)[]) if (k !== "date") (t[k] as number) += d[k] as number;
    return t;
  }, emptyDay(`${from}…${to}`));
  return {
    from,
    to,
    days,
    totals,
    avgLatencyMs: totals.total > 0 ? totals.latencySumMs / totals.total : null,
    avgReviewMinutes: data.avgReviewMinutes,
    feedback: reviewFeedback({ open: totals.open, confirmed_fraud: totals.confirmedFraud, false_positive: totals.falsePositive }),
    labelled: performance(data.labelled),
    topAlerts: data.topAlerts,
  };
}

/** RFC 4180 CSV. Text that a spreadsheet would run as a formula (=, +, -, @) is prefixed with '. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
