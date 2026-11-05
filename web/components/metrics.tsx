import type { Performance } from "@/lib/schemas";
import { fmtCount } from "./format";

export const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

/** A labelled figure in a soft tile. */
export function Metric({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <div className="text-xs font-semibold text-ink-2">{label}</div>
      <div className="mt-1.5 text-xl font-extrabold text-ink tabular-nums">{value}</div>
      {note && <div className="mt-1 text-xs text-ink-2">{note}</div>}
    </div>
  );
}

/** Precision, recall and F1 on the fraud class, each with the counts behind it. */
export function PerformanceRow({ p }: { p: Performance }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Precision" value={pct(p.precision)} note={`${p.tp} of ${p.tp + p.fp} alerts were fraud`} />
      <Metric label="Recall" value={pct(p.recall)} note={`${p.tp} of ${p.positives} fraud transactions caught`} />
      <Metric label="F1 (fraud class)" value={p.f1 === null ? "—" : p.f1.toFixed(3)} note={`${fmtCount(p.n)} labelled transactions`} />
    </div>
  );
}
