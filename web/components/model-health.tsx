"use client";

import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchModelHealth } from "@/lib/live";
import type { Actor, FeatureDrift, ModelHealth, Performance } from "@/lib/schemas";
import { fmtCount, fmtDateTime, fmtThreshold } from "./format";
import { Metric, PerformanceRow, pct } from "./metrics";
import { Button, Card, LevelBadge, PageHeader, StubBadge, SummaryBar, buttonClass, tableHeadRow } from "./ui";

const DRIFT_ROWS = 10;
const PSI_SCALE = 0.5; // meters run 0 … 0.5; anything beyond is pinned full

function PsiMeter({ d }: { d: FeatureDrift }) {
  const color = d.level === "significant" ? "var(--critical)" : d.level === "moderate" ? "var(--warning)" : "var(--good)";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative block h-1.5 w-28 overflow-hidden rounded-full bg-track">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(1, d.psi / PSI_SCALE) * 100}%`, background: color }} />
        {/* the 0.1 and 0.25 cut-offs */}
        <span className="absolute inset-y-0 w-px bg-surface" style={{ left: `${(0.1 / PSI_SCALE) * 100}%` }} />
        <span className="absolute inset-y-0 w-px bg-surface" style={{ left: `${(0.25 / PSI_SCALE) * 100}%` }} />
      </span>
      <span className="w-12 text-right font-semibold tabular-nums">{d.psi.toFixed(3)}</span>
    </span>
  );
}

function CompareRow({ label, active, shadow, fmt }: { label: string; active: number | null; shadow: number | null; fmt: (x: number | null) => string }) {
  const better = active !== null && shadow !== null && shadow !== active ? (shadow > active ? "shadow" : "active") : null;
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-5 py-2.5 text-ink-2">{label}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${better === "active" ? "font-extrabold" : ""}`}>{fmt(active)}</td>
      <td className={`px-5 py-2.5 text-right tabular-nums ${better === "shadow" ? "font-extrabold" : ""}`}>{fmt(shadow)}</td>
    </tr>
  );
}

function perfRows(a: Performance, s: Performance) {
  return (
    <>
      <CompareRow label="Precision" active={a.precision} shadow={s.precision} fmt={pct} />
      <CompareRow label="Recall" active={a.recall} shadow={s.recall} fmt={pct} />
      <CompareRow label="F1 (fraud class)" active={a.f1} shadow={s.f1} fmt={(x) => (x === null ? "—" : x.toFixed(3))} />
    </>
  );
}

export function ModelHealthView({ actor }: { actor: Actor }) {
  const [health, setHealth] = useState<ModelHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchModelHealth()
      .then(setHealth)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load model health."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const h = health;
  const drift = h?.drift;
  const worst = drift?.features[0];

  return (
    <>
      <PageHeader title="Model health" subtitle="How the active model is performing on live traffic, and whether that traffic still looks like what it learned from">
        {actor.role === "admin" && (
          <a href="/api/admin/feedback" className={buttonClass("secondary")}>
            <Download size={16} /> Analyst feedback CSV
          </a>
        )}
        <Button onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </PageHeader>

      {error && <p className="mb-5 rounded-lg bg-banner px-4 py-3 text-sm">{error}</p>}

      <Card title="Active model">
        {h && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Version"
              value={<code className="break-all font-mono text-base">{h.config.activeModelVersion}</code>}
              note={h.config.activeModelStub ? <StubBadge /> : "trained bundle"}
            />
            <Metric label="Alert threshold" value={fmtThreshold(h.config.threshold)} note="probability ≥ threshold raises an alert" />
            <Metric
              label="Suggested threshold"
              value={h.suggestedThreshold === null ? "—" : fmtThreshold(h.suggestedThreshold)}
              note="max validation F1 when trained"
            />
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Live performance · dataset labels">
          {h && h.live.n > 0 ? (
            <PerformanceRow p={h.live} />
          ) : (
            <p className="text-sm text-ink-2">No scored transaction from this model carries an evaluation label yet. The simulator sends the dataset&apos;s label with each row.</p>
          )}
          <p className="mt-3 text-xs text-ink-2">At the current threshold, over the model&apos;s latest 50,000 labelled transactions. Labels are never shown to the model.</p>
        </Card>

        <Card title="Analyst feedback loop">
          {h && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Alerts reviewed" value={fmtCount(h.feedback.reviewed)} />
              <Metric label="Confirmed fraud" value={fmtCount(h.feedback.confirmedFraud)} note={`${h.feedback.falsePositive} false positive`} />
              <Metric label="Alert precision" value={pct(h.feedback.precision)} note="confirmed ÷ reviewed" />
            </div>
          )}
          <p className="mt-3 text-xs text-ink-2">
            Every decision is a label. {actor.role === "admin" ? "Export them (CSV, creditcard.csv column order) to retrain. " : ""}Rows the simulator replays come from
            the test split, so never add those to training data.
          </p>
        </Card>
      </div>

      <div className="mt-5">
        <SummaryBar
          label="Input drift since this model went live"
          value={!drift ? "—" : drift.score ? <LevelBadge level={worst && worst.psi > drift.score.psi ? worst.level : drift.score.level} /> : "Not enough data"}
        >
          {drift && drift.windowSize > 0
            ? `First ${fmtCount(drift.windowSize)} scored transactions (${fmtDateTime(drift.referenceFrom!)} – ${fmtDateTime(drift.referenceTo!)}) vs the latest ${fmtCount(drift.windowSize)} (${fmtDateTime(drift.currentFrom!)} – ${fmtDateTime(drift.currentTo!)})`
            : "Needs at least 200 scored transactions from this model."}
        </SummaryBar>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Drift by feature (PSI)" flush>
          {drift && drift.score ? (
            <div className="overflow-x-auto px-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className={tableHeadRow}>
                    <th className="px-5 py-3 font-bold">Feature</th>
                    <th className="px-3 py-3 font-bold">PSI</th>
                    <th className="px-5 py-3 font-bold">Level</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line bg-brand-50/50">
                    <td className="px-5 py-2.5 font-bold">{drift.score.feature}</td>
                    <td className="px-3 py-2.5">
                      <PsiMeter d={drift.score} />
                    </td>
                    <td className="px-5 py-2.5">
                      <LevelBadge level={drift.score.level} />
                    </td>
                  </tr>
                  {drift.features.slice(0, DRIFT_ROWS).map((d) => (
                    <tr key={d.feature} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5 font-semibold">{d.feature}</td>
                      <td className="px-3 py-2.5">
                        <PsiMeter d={d} />
                      </td>
                      <td className="px-5 py-2.5">
                        <LevelBadge level={d.level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 pb-3 pt-2 text-xs text-ink-2">
                Population Stability Index over reference deciles: under 0.10 stable, 0.10–0.25 moderate, above 0.25 significant. The {DRIFT_ROWS} most drifted of 29 inputs
                shown; Time is excluded because a replay only moves forward in it.
              </p>
            </div>
          ) : (
            <p className="px-6 pb-4 text-sm text-ink-2">Drift needs at least 100 transactions in each window.</p>
          )}
        </Card>

        <Card title="Champion vs challenger">
          {!h ? null : !h.shadow ? (
            <div className="text-sm text-ink-2">
              <p>No shadow model is running. Start the inference service with a challenger to score every transaction twice; only the active model raises alerts.</p>
              <code className="mt-3 block overflow-x-auto whitespace-pre rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-ink">
                {"$env:SHADOW_MODEL_BUNDLE = \"..\\models\\shadow\\<version>\"\n..\\.venv\\Scripts\\uvicorn app.main:app --port 8000 --env-file .env"}
              </code>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Decision agreement" value={pct(h.shadow.agreement)} note={`over ${fmtCount(h.shadow.n)} transactions`} />
                <Metric label="Alerts it would raise" value={fmtCount(h.shadow.shadowAlerts)} note={`active raised ${fmtCount(h.shadow.activeAlerts)}`} />
                <Metric label="Mean score gap" value={`${(h.shadow.meanAbsDifference * 100).toFixed(1)} pts`} />
              </div>
              <div className="-mx-3 mt-4 overflow-x-auto px-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={tableHeadRow}>
                      <th className="px-5 py-3 font-bold">At threshold {fmtThreshold(h.shadow.threshold)}</th>
                      <th className="px-3 py-3 text-right font-bold" title={h.shadow.activeModelVersion}>
                        Active
                      </th>
                      <th className="px-5 py-3 text-right font-bold" title={h.shadow.shadowModelVersion}>
                        Shadow
                      </th>
                    </tr>
                  </thead>
                  <tbody>{perfRows(h.shadow.active, h.shadow.shadow)}</tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-ink-2">
                Active <code className="font-mono">{h.shadow.activeModelVersion}</code> vs shadow <code className="font-mono">{h.shadow.shadowModelVersion}</code>, on
                the {fmtCount(h.shadow.active.n)} labelled transactions both scored; the better figure is bold. To promote the challenger, point MODEL_BUNDLE at it,
                restart inference, and run seed-config.ts for its threshold.
              </p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
