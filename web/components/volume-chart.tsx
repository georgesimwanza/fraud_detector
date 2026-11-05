"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Transaction } from "@/lib/schemas";

const MINUTES = 30;
const HEIGHT = 220;
const M = { top: 12, right: 8, bottom: 26, left: 34 };
const GAP = 2; // surface gap between stacked segments

interface Bucket {
  start: number;
  cleared: number;
  flagged: number;
}

function bucketize(txs: Transaction[], now: number): Bucket[] {
  const end = Math.floor(now / 60_000) * 60_000;
  const buckets = Array.from({ length: MINUTES }, (_, i) => ({ start: end - (MINUTES - 1 - i) * 60_000, cleared: 0, flagged: 0 }));
  for (const t of txs) {
    if (t.status !== "scored") continue;
    const i = MINUTES - 1 - Math.floor((end - Math.floor(t.receivedAt / 60_000) * 60_000) / 60_000);
    if (i < 0 || i >= MINUTES) continue;
    if (t.isAlert) buckets[i].flagged += 1;
    else buckets[i].cleared += 1;
  }
  return buckets;
}

function niceTicks(max: number): number[] {
  const raw = Math.max(1, max) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/** Rect with 4px rounded top corners and a square base. */
function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function VolumeChart({ transactions }: { transactions: Transaction[] }) {
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

  const buckets = useMemo(() => bucketize(transactions, Date.now()), [transactions]);
  const ticks = niceTicks(Math.max(...buckets.map((b) => b.cleared + b.flagged)));
  const top = ticks[ticks.length - 1];

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;
  const slot = innerW / MINUTES;
  const barW = Math.min(24, slot * 0.62);
  const y = (v: number) => M.top + innerH * (1 - v / top);
  const baseline = y(0);

  const hovered = hover === null ? null : buckets[hover];
  const tooltipLeft = hover === null ? 0 : Math.min(Math.max(M.left + hover * slot + slot / 2, 70), width - 70);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-1" /> Below threshold
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-3" /> Flagged as high risk
        </span>
      </div>

      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`Scored transactions per minute, last ${MINUTES} minutes`} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">
                {t}
              </text>
            </g>
          ))}

          {hover !== null && <rect x={M.left + hover * slot} y={M.top} width={slot} height={innerH} fill="var(--surface-2)" />}

          {buckets.map((b, i) => {
            const x = M.left + i * slot + (slot - barW) / 2;
            const hC = baseline - y(b.cleared);
            const flaggedBase = b.cleared > 0 ? baseline - hC - GAP : baseline;
            const hF = b.flagged > 0 ? Math.max(1, flaggedBase - y(b.cleared + b.flagged)) : 0;
            return (
              <g key={b.start}>
                {b.cleared > 0 &&
                  (b.flagged > 0 ? (
                    <rect x={x} y={baseline - hC} width={barW} height={hC} fill="var(--series-1)" />
                  ) : (
                    <path d={topRounded(x, baseline - hC, barW, hC)} fill="var(--series-1)" />
                  ))}
                {b.flagged > 0 && <path d={topRounded(x, flaggedBase - hF, barW, hF)} fill="var(--series-3)" />}
                {i % 5 === 0 && (
                  <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tabular-nums">
                    {hhmm(b.start)}
                  </text>
                )}
                <rect
                  x={M.left + i * slot}
                  y={M.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md bg-navy px-3 py-2 text-xs text-white shadow-lg"
            style={{ left: tooltipLeft }}
          >
            <div className="mb-1 font-bold tabular-nums">
              {hhmm(hovered.start)}–{hhmm(hovered.start + 60_000)}
            </div>
            <div className="flex items-center gap-1.5 text-white/75">
              <span className="h-2 w-2 rounded-sm bg-series-3" /> Flagged <span className="ml-auto pl-3 font-bold text-white tabular-nums">{hovered.flagged}</span>
            </div>
            <div className="flex items-center gap-1.5 text-white/75">
              <span className="h-2 w-2 rounded-sm bg-series-1" /> Below threshold <span className="ml-auto pl-3 font-bold text-white tabular-nums">{hovered.cleared}</span>
            </div>
          </div>
        )}
      </div>

      <details className="mt-3 text-xs text-ink-2">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full tabular-nums">
            <thead className="text-left">
              <tr>
                <th className="py-1 font-medium">Minute</th>
                <th className="py-1 text-right font-medium">Below threshold</th>
                <th className="py-1 text-right font-medium">Flagged</th>
              </tr>
            </thead>
            <tbody>
              {[...buckets].reverse().map((b) => (
                <tr key={b.start} className="border-t border-line text-ink">
                  <td className="py-1">{hhmm(b.start)}</td>
                  <td className="py-1 text-right">{b.cleared}</td>
                  <td className="py-1 text-right">{b.flagged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
