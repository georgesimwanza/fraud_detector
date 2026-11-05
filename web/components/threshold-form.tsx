"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchThresholdCurve, subscribeConfig, updateThreshold, type ThresholdCurve } from "@/lib/live";
import type { Config } from "@/lib/schemas";
import { fmtCount, fmtMoney, fmtThreshold } from "./format";
import { Metric, pct } from "./metrics";
import { Button, Card, Field, PageHeader, StubBadge, SummaryBar, inputClass } from "./ui";
import { ThresholdCurveChart, type CurveRow } from "./threshold-curve-chart";
import { useLive } from "./use-live";

const at = (rows: CurveRow[], t: number) => rows.find((r) => Math.abs(r.threshold - t) < 1e-9) ?? null;

export function ThresholdForm() {
  const config = useLive<Config>(subscribeConfig, []);
  const [curve, setCurve] = useState<ThresholdCurve | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [reviewCost, setReviewCost] = useState(5);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetchThresholdCurve()
      .then(setCurve)
      .catch((e) => setCurveError(e instanceof Error ? e.message : "Could not load the threshold curve."));
  }, [config?.activeModelVersion]);

  const rows: CurveRow[] = useMemo(
    () =>
      (curve?.points ?? []).map((p) => ({
        ...p,
        precision: p.tp + p.fp > 0 ? p.tp / (p.tp + p.fp) : null,
        recall: p.tp + p.fn > 0 ? p.tp / (p.tp + p.fn) : null,
      })),
    [curve],
  );
  // Cost of a threshold: every alert costs a review; every missed fraud costs its amount.
  const cost = (r: CurveRow) => (r.tp + r.fp) * reviewCost + r.missedFraudAmount;
  const cheapest = rows.length && curve && curve.positives > 0 ? rows.reduce((best, r) => (cost(r) < cost(best) ? r : best)) : null;

  if (!config) return <PageHeader title="Settings" />;

  const value = draft ?? config.threshold;
  const changed = Math.abs(value - config.threshold) > 1e-9;
  const now = at(rows, Number(config.threshold.toFixed(2)));
  const next = at(rows, Number(value.toFixed(2)));

  async function save() {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      await updateThreshold(Number(value.toFixed(2)));
      setDraft(null);
      setDone(`Threshold set to ${fmtThreshold(value)}. New transactions are judged under it from now on.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the threshold.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Admin only · changes are audit-logged">
        {changed && (
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Reset to {fmtThreshold(config.threshold)}
          </Button>
        )}
        <Button onClick={save} disabled={!changed || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Alert threshold">
            <p className="text-sm text-ink-2">
              A transaction becomes an alert when its fraud probability is at or above this value. Stored transactions keep the threshold they were judged under.
            </p>
            <div className="mt-5 flex items-center gap-4">
              <input
                type="range"
                min={0.01}
                max={0.99}
                step={0.01}
                value={value}
                onChange={(e) => setDraft(Number(e.target.value))}
                aria-label="Threshold"
                className="flex-1 accent-[var(--accent)]"
              />
              <input
                type="number"
                min={0.01}
                max={0.99}
                step={0.01}
                value={value.toFixed(2)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setDraft(Math.min(0.99, Math.max(0.01, n)));
                }}
                aria-label="Threshold value"
                className={`${inputClass} w-24! text-right font-bold tabular-nums`}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-ink-2">
              <span>More alerts</span>
              <span>Fewer alerts</span>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-critical">
                {error}
              </p>
            )}
            {done && (
              <p role="status" className="mt-3 text-sm">
                ✓ {done}
              </p>
            )}
          </Card>

          <Card title="What-if · precision and recall by threshold">
            {curveError ? (
              <p className="text-sm text-critical">{curveError}</p>
            ) : !curve ? (
              <p className="text-sm text-ink-2">Loading…</p>
            ) : curve.positives === 0 ? (
              <p className="text-sm text-ink-2">
                No labelled fraud has been scored by <code className="font-mono">{curve.modelVersion}</code> yet, so precision and recall can&apos;t be estimated. Run the
                simulator (it sends the dataset label) and come back.
              </p>
            ) : (
              <>
                <ThresholdCurveChart rows={rows} current={config.threshold} candidate={value} onPick={setDraft} />
                <p className="mt-2 text-xs text-ink-2">
                  From {fmtCount(curve.n)} transactions scored by <code className="font-mono">{curve.modelVersion}</code> that carry a dataset label ({fmtCount(curve.positives)}{" "}
                  fraud). Labels are used only here and in evaluation, never by the model.
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {curve && curve.positives > 0 && now && next && (
            <Card title={changed ? `${fmtThreshold(config.threshold)} → ${fmtThreshold(value)}` : `At ${fmtThreshold(value)}`}>
              <div className="grid gap-3">
                <Metric label="Precision" value={pct(next.precision)} note={changed ? `now ${pct(now.precision)}` : "alerts that are fraud"} />
                <Metric label="Recall" value={pct(next.recall)} note={changed ? `now ${pct(now.recall)}` : "fraud that is caught"} />
                <Metric
                  label="Alerts per 1,000 transactions"
                  value={(((next.tp + next.fp) / curve.n) * 1000).toFixed(1)}
                  note={changed ? `now ${(((now.tp + now.fp) / curve.n) * 1000).toFixed(1)}` : undefined}
                />
              </div>
            </Card>
          )}

          {cheapest && (
            <Card title="Cost model">
              <Field label="Cost of reviewing one alert" hint="Missed fraud costs its transaction amount.">
                <span className="relative block">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-2">$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={reviewCost}
                    onChange={(e) => setReviewCost(Math.max(0, Number(e.target.value) || 0))}
                    className={`${inputClass} pl-7! tabular-nums`}
                  />
                </span>
              </Field>
              <div className="mt-4">
                <SummaryBar label="Lowest-cost threshold" value={fmtThreshold(cheapest.threshold)}>
                  {fmtMoney(cost(cheapest))} vs {fmtMoney(next ? cost(next) : 0)} at {fmtThreshold(value)}
                </SummaryBar>
              </div>
              <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={() => setDraft(cheapest.threshold)} disabled={Math.abs(cheapest.threshold - value) < 1e-9}>
                Use {fmtThreshold(cheapest.threshold)}
              </Button>
            </Card>
          )}

          <Card title="Active model">
            <div className="flex flex-col items-start gap-2 text-sm">
              <code className="break-all font-mono">{config.activeModelVersion}</code>
              {config.activeModelStub && <StubBadge />}
              <p className="text-ink-2">
                Saved threshold <strong className="text-ink tabular-nums">{fmtThreshold(config.threshold)}</strong>
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
