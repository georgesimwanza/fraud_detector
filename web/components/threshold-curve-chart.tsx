"use client";

import { useEffect, useRef, useState } from "react";
import type { CurvePoint } from "@/lib/schemas";
import { fmtThreshold } from "./format";

const HEIGHT = 240;
const M = { top: 16, right: 12, bottom: 30, left: 42 };

export interface CurveRow extends CurvePoint {
  precision: number | null;
  recall: number | null;
}

function path(rows: CurveRow[], pick: (r: CurveRow) => number | null, x: (t: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(r.threshold).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * Precision and recall (both 0–100 %, one axis) across every settable threshold. Two vertical
 * markers: the saved threshold and the candidate. Hover for the figures; click to pick.
 */
export function ThresholdCurveChart({
  rows,
  current,
  candidate,
  onPick,
}: {
  rows: CurveRow[];
  current: number;
  candidate: number;
  onPick: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<CurveRow | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;
  const x = (t: number) => M.left + innerW * t;
  const y = (v: number) => M.top + innerH * (1 - v);
  const nearest = (px: number) => {
    const t = Math.min(0.99, Math.max(0.01, Math.round(((px - M.left) / innerW) * 100) / 100));
    return rows.find((r) => Math.abs(r.threshold - t) < 1e-9) ?? null;
  };

  const tip = hover ? Math.min(Math.max(x(hover.threshold), 90), width - 90) : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-series-1" /> Precision
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-series-2" /> Recall
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-ink" /> Saved threshold
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-accent" /> Candidate
        </span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Precision and recall at each alert threshold"
          className="block cursor-crosshair"
          onMouseMove={(e) => setHover(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
          onClick={(e) => {
            const r = nearest(e.clientX - e.currentTarget.getBoundingClientRect().left);
            if (r) onPick(r.threshold);
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} />
              <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                {v * 100}%
              </text>
            </g>
          ))}
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
            <text key={t} x={x(t)} y={HEIGHT - 10} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {t.toFixed(1)}
            </text>
          ))}
          <line x1={x(current)} x2={x(current)} y1={M.top} y2={y(0)} stroke="var(--ink)" strokeWidth={1.5} />
          {Math.abs(candidate - current) > 1e-9 && <line x1={x(candidate)} x2={x(candidate)} y1={M.top} y2={y(0)} stroke="var(--accent)" strokeWidth={2} />}
          {hover && <line x1={x(hover.threshold)} x2={x(hover.threshold)} y1={M.top} y2={y(0)} stroke="var(--axis)" />}

          <path d={path(rows, (r) => r.precision, x, y)} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(rows, (r) => r.recall, x, y)} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover &&
            [
              { v: hover.precision, c: "var(--series-1)" },
              { v: hover.recall, c: "var(--series-2)" },
            ].map(
              ({ v, c }, i) => v !== null && <circle key={i} cx={x(hover.threshold)} cy={y(v)} r={4.5} fill={c} stroke="var(--surface)" strokeWidth={2} />,
            )}
        </svg>

        {hover && (
          <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md bg-navy px-3 py-2 text-xs text-white shadow-lg" style={{ left: tip }}>
            <div className="mb-1 font-bold">Threshold {fmtThreshold(hover.threshold)}</div>
            <div className="flex gap-4 text-white/75">
              Precision <span className="ml-auto font-bold text-white tabular-nums">{hover.precision === null ? "—" : `${(hover.precision * 100).toFixed(1)}%`}</span>
            </div>
            <div className="flex gap-4 text-white/75">
              Recall <span className="ml-auto font-bold text-white tabular-nums">{hover.recall === null ? "—" : `${(hover.recall * 100).toFixed(1)}%`}</span>
            </div>
            <div className="flex gap-4 text-white/75">
              Alerts <span className="ml-auto font-bold text-white tabular-nums">{hover.tp + hover.fp}</span>
            </div>
            <div className="mt-1 text-white/60">click to use this threshold</div>
          </div>
        )}
      </div>
      <details className="mt-3 text-xs text-ink-2">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full tabular-nums">
            <thead className="text-left">
              <tr>
                <th className="py-1 font-semibold">Threshold</th>
                <th className="py-1 text-right font-semibold">Precision</th>
                <th className="py-1 text-right font-semibold">Recall</th>
                <th className="py-1 text-right font-semibold">Alerts</th>
                <th className="py-1 text-right font-semibold">Missed fraud</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.threshold} className="border-t border-line text-ink">
                  <td className="py-1">{fmtThreshold(r.threshold)}</td>
                  <td className="py-1 text-right">{r.precision === null ? "—" : `${(r.precision * 100).toFixed(1)}%`}</td>
                  <td className="py-1 text-right">{r.recall === null ? "—" : `${(r.recall * 100).toFixed(1)}%`}</td>
                  <td className="py-1 text-right">{r.tp + r.fp}</td>
                  <td className="py-1 text-right">{r.fn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
