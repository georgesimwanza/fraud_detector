"use client";

import { useEffect, useRef, useState } from "react";

const HEIGHT = 240;
const M = { top: 14, right: 8, bottom: 28, left: 40 };
const GAP = 2; // surface gap between stacked segments

export interface Series {
  key: string;
  label: string;
  color: string; // CSS colour (a token var)
}

function niceTicks(max: number): number[] {
  const raw = Math.max(1, max) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Rect with 4px rounded top corners and a square base. */
function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Stacked columns, one per category, with a legend, a navy hover tooltip and a table view. */
export function StackedColumns({
  categories,
  series,
  values,
  label,
  formatCategory = (c) => c,
}: {
  categories: string[];
  series: Series[];
  values: Record<string, number>[]; // one per category, keyed by series key
  label: string;
  formatCategory?: (c: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = values.map((v) => series.reduce((s, x) => s + (v[x.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;
  const slot = categories.length ? innerW / categories.length : innerW;
  const barW = Math.min(24, slot * 0.62);
  const y = (v: number) => M.top + innerH * (1 - v / top);
  const baseline = y(0);
  const labelEvery = Math.max(1, Math.ceil(categories.length / Math.max(1, Math.floor(innerW / 64))));
  const tooltipLeft = hover === null ? 0 : Math.min(Math.max(M.left + hover * slot + slot / 2, 80), width - 80);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>

      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={label} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">
                {t >= 1000 ? compact.format(t) : t}
              </text>
            </g>
          ))}
          {hover !== null && <rect x={M.left + hover * slot} y={M.top} width={slot} height={innerH} fill="var(--surface-2)" />}

          {categories.map((c, i) => {
            const x = M.left + i * slot + (slot - barW) / 2;
            const present = series.filter((s) => (values[i][s.key] ?? 0) > 0);
            let cursor = baseline;
            return (
              <g key={c}>
                {present.map((s, k) => {
                  const h = Math.max(1, baseline - y(values[i][s.key]) - (k > 0 ? GAP : 0));
                  const yTop = cursor - (k > 0 ? GAP : 0) - h;
                  cursor = yTop;
                  return k === present.length - 1 ? (
                    <path key={s.key} d={topRounded(x, yTop, barW, h)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={x} y={yTop} width={barW} height={h} fill={s.color} />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tabular-nums">
                    {formatCategory(c)}
                  </text>
                )}
                <rect x={M.left + i * slot} y={M.top} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              </g>
            );
          })}
        </svg>

        {hover !== null && (
          <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md bg-navy px-3 py-2 text-xs text-white shadow-lg" style={{ left: tooltipLeft }}>
            <div className="mb-1 font-bold">{formatCategory(categories[hover])}</div>
            {[...series].reverse().map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-white/75">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} /> {s.label}
                <span className="ml-auto pl-4 font-bold text-white tabular-nums">{(values[hover][s.key] ?? 0).toLocaleString("en-US")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="mt-3 text-xs text-ink-2">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full tabular-nums">
            <thead className="text-left">
              <tr>
                <th className="py-1 font-semibold">Day</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 text-right font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c} className="border-t border-line text-ink">
                  <td className="py-1">{formatCategory(c)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 text-right">
                      {(values[i][s.key] ?? 0).toLocaleString("en-US")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
