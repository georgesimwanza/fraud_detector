"use client";

import { useState } from "react";
import type { Explanation } from "@/lib/schemas";
import { fmtProb } from "./format";

const TOP = 8;
const ROW = 30;
const BAR = 14;

const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts`;
const fmtValue = (feature: string, v: number) => (feature === "Amount" ? `$${v.toFixed(2)}` : feature === "Time" ? `${Math.round(v)} s` : v.toFixed(2));

/**
 * Diverging bars: how far each feature moved the fraud probability from the average transaction
 * (integrated gradients). Coral pushes toward fraud, blue toward legitimate. The top features are
 * drawn; the rest are summed into one line and every value is in the table view.
 */
export function ExplanationChart({ explanation }: { explanation: Explanation }) {
  const [hover, setHover] = useState<number | null>(null);
  const ranked = [...explanation.attributions].sort((a, b) => Math.abs(b.attribution) - Math.abs(a.attribution));
  const top = ranked.slice(0, TOP);
  const rest = ranked.slice(TOP).reduce((s, a) => s + a.attribution, 0);
  const max = Math.max(1e-9, ...top.map((a) => Math.abs(a.attribution)));

  return (
    <div>
      <p className="text-sm text-ink-2">
        An average transaction scores <strong className="text-ink tabular-nums">{fmtProb(explanation.baselineProbability)}</strong>. These features moved
        this one to <strong className="text-ink tabular-nums">{fmtProb(explanation.probability)}</strong>.
      </p>

      <div className="mb-2 mt-4 flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-3" /> Pushes toward fraud
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-1" /> Pushes toward legitimate
        </span>
      </div>

      <div role="img" aria-label={`Top ${TOP} features by contribution to the fraud probability`} onMouseLeave={() => setHover(null)}>
        {top.map((a, i) => {
          const share = Math.abs(a.attribution) / max;
          const up = a.attribution >= 0;
          return (
            <div
              key={a.feature}
              onMouseEnter={() => setHover(i)}
              className={`grid grid-cols-[96px_1fr_1fr_76px] items-center gap-0 rounded-md px-1 ${hover === i ? "bg-surface-2" : ""}`}
              style={{ height: ROW }}
              title={`${a.feature} = ${fmtValue(a.feature, a.value)}: ${signed(a.attribution)}`}
            >
              <span className="truncate text-xs">
                <span className="font-bold text-ink">{a.feature}</span> <span className="text-ink-2 tabular-nums">{fmtValue(a.feature, a.value)}</span>
              </span>
              {/* left half: toward legitimate (grows leftward from the centre line) */}
              <span className="flex h-full items-center justify-end border-r border-axis pr-px">
                {!up && <span className="rounded-l-[4px]" style={{ width: `${share * 100}%`, height: BAR, background: "var(--series-1)" }} />}
              </span>
              <span className="flex h-full items-center pl-px">
                {up && <span className="rounded-r-[4px]" style={{ width: `${share * 100}%`, height: BAR, background: "var(--series-3)" }} />}
              </span>
              <span className="text-right text-xs font-semibold text-ink tabular-nums">{signed(a.attribution)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between border-t border-line px-1 pt-2 text-xs text-ink-2">
        <span>Other {ranked.length - top.length} features combined</span>
        <span className="font-semibold text-ink tabular-nums">{signed(rest)}</span>
      </div>

      <details className="mt-3 text-xs text-ink-2">
        <summary className="cursor-pointer select-none">View all 30 as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full tabular-nums">
            <thead className="text-left">
              <tr>
                <th className="py-1 font-semibold">Feature</th>
                <th className="py-1 text-right font-semibold">Value</th>
                <th className="py-1 text-right font-semibold">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a) => (
                <tr key={a.feature} className="border-t border-line text-ink">
                  <td className="py-1">{a.feature}</td>
                  <td className="py-1 text-right">{fmtValue(a.feature, a.value)}</td>
                  <td className="py-1 text-right">{signed(a.attribution)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">
            Method: integrated gradients, 64 steps, from a baseline of the average transaction. Contributions sum to the score difference within{" "}
            {Math.abs(explanation.residual * 100).toFixed(2)} pts.
          </p>
        </div>
      </details>
    </div>
  );
}
