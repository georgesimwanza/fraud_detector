"use client";

import { Activity, Download, Gauge, Printer, ShieldAlert, ShieldX, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchReport, reportCsvUrl } from "@/lib/live";
import type { Report } from "@/lib/schemas";
import { Metric, PerformanceRow, pct } from "./metrics";
import { fmtCount, fmtDateTime, fmtMoney } from "./format";
import { AlertStatusBadge, Button, Card, EmptyState, PageHeader, ProbabilityBar, Segmented, StatTile, SummaryBar, buttonClass, inputClass, tableHeadRow } from "./ui";
import { StackedColumns } from "./stacked-columns";

type Preset = "7" | "30" | "90" | "custom";

function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
/** FR10: fraud statistics for a selected period. */
export function Reports() {
  const [preset, setPreset] = useState<Preset>("7");
  const [from, setFrom] = useState(localDay(-6));
  const [to, setTo] = useState(localDay());
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      setFrom(localDay(1 - Number(p)));
      setTo(localDay());
    }
  }

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchReport(from, to)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the report."));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const t = report?.totals;
  const scored = t ? t.total - t.scoringFailed : 0;

  return (
    <>
      <PageHeader title="Reports" subtitle={report ? `${shortDay(report.from)} – ${shortDay(report.to)} · ${report.days.length} days` : "Fraud statistics for a period"}>
        <a href={reportCsvUrl(from, to)} className={buttonClass("secondary")}>
          <Download size={16} /> Export CSV
        </a>
        <Button onClick={() => window.print()}>
          <Printer size={16} /> Print
        </Button>
      </PageHeader>

      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <Segmented
          label="Period"
          value={preset}
          onChange={choose}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink-2">
            <label className="flex items-center gap-2">
              From <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputClass} w-auto! py-1.5!`} />
            </label>
            <label className="flex items-center gap-2">
              To <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${inputClass} w-auto! py-1.5!`} />
            </label>
          </div>
        )}
      </div>

      {error && <p className="mb-5 rounded-lg bg-banner px-4 py-3 text-sm">{error}</p>}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Transactions"
          value={t ? fmtCount(t.total) : "—"}
          tone="blue"
          icon={<Activity size={22} strokeWidth={2.4} />}
          footer={<span>{t?.scoringFailed ? `${t.scoringFailed} could not be scored` : "all scored"}</span>}
        />
        <StatTile
          label="Alerts raised"
          value={t ? fmtCount(t.alerts) : "—"}
          tone="coral"
          icon={<ShieldAlert size={22} strokeWidth={2.4} />}
          footer={<span>{t && scored > 0 ? `${((t.alerts / scored) * 100).toFixed(1)}% of scored traffic` : "—"}</span>}
        />
        <StatTile
          label="Confirmed fraud"
          value={t ? fmtCount(t.confirmedFraud) : "—"}
          tone="violet"
          icon={<ShieldX size={22} strokeWidth={2.4} />}
          footer={<span>{t ? `${t.falsePositive} false positive · ${t.open} still open` : "—"}</span>}
        />
        <StatTile
          label="Avg latency"
          value={report?.avgLatencyMs != null ? `${Math.round(report.avgLatencyMs)} ms` : "—"}
          tone="teal"
          icon={<Gauge size={22} strokeWidth={2.4} />}
          footer={
            <>
              <Timer size={16} className="text-[var(--tile-teal-fg)]" aria-hidden />
              <span>
                review in <strong className="font-bold text-ink">{report?.avgReviewMinutes != null ? `${report.avgReviewMinutes.toFixed(1)} min` : "—"}</strong> on average
              </span>
            </>
          }
        />
      </div>

      <div className="mt-5">
        <SummaryBar label="Confirmed fraud value in this period" value={t ? fmtMoney(t.confirmedFraudAmount) : "—"}>
          {t ? `${fmtMoney(t.alertAmount)} was flagged for review in total` : null}
        </SummaryBar>
      </div>

      <Card title="Alerts per day, by outcome" className="mt-5">
        {report && (
          <StackedColumns
            label="Alerts per day by outcome"
            categories={report.days.map((d) => d.date)}
            formatCategory={shortDay}
            series={[
              { key: "confirmed", label: "Confirmed fraud", color: "var(--series-3)" },
              { key: "falsePositive", label: "False positive", color: "var(--series-2)" },
              { key: "open", label: "Open", color: "var(--series-1)" },
            ]}
            values={report.days.map((d) => ({ confirmed: d.confirmedFraud, falsePositive: d.falsePositive, open: d.open }))}
          />
        )}
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Analyst decisions">
          {report && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Reviewed" value={fmtCount(report.feedback.reviewed)} />
              <Metric label="Confirmed fraud" value={fmtCount(report.feedback.confirmedFraud)} />
              <Metric label="Alert precision" value={pct(report.feedback.precision)} note="confirmed ÷ reviewed" />
            </div>
          )}
        </Card>
        <Card title="Against dataset labels">
          {report && report.labelled.n > 0 ? (
            <PerformanceRow p={report.labelled} />
          ) : (
            <p className="text-sm text-ink-2">No transactions in this period carried an evaluation label.</p>
          )}
        </Card>
      </div>

      <Card title="Day by day" className="mt-5" flush>
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead>
              <tr className={tableHeadRow}>
                <th className="px-5 py-3 font-bold">Day</th>
                <th className="px-3 py-3 text-right font-bold">Transactions</th>
                <th className="px-3 py-3 text-right font-bold">Alerts</th>
                <th className="px-3 py-3 text-right font-bold">Confirmed</th>
                <th className="px-3 py-3 text-right font-bold">False positive</th>
                <th className="px-3 py-3 text-right font-bold">Open</th>
                <th className="px-5 py-3 text-right font-bold">Confirmed value</th>
              </tr>
            </thead>
            <tbody>
              {report?.days
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.date} className={`border-b border-line last:border-0 ${d.total === 0 ? "text-muted" : ""}`}>
                    <td className="px-5 py-2.5">{shortDay(d.date)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtCount(d.total)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtCount(d.alerts)}</td>
                    <td className="px-3 py-2.5 text-right">{d.confirmedFraud}</td>
                    <td className="px-3 py-2.5 text-right">{d.falsePositive}</td>
                    <td className="px-3 py-2.5 text-right">{d.open}</td>
                    <td className="px-5 py-2.5 text-right font-semibold">{fmtMoney(d.confirmedFraudAmount)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Highest-risk alerts in the period" className="mt-5" flush>
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={tableHeadRow}>
                <th className="px-5 py-3 font-bold">Alert</th>
                <th className="px-3 py-3 font-bold">Raised</th>
                <th className="px-3 py-3 text-right font-bold">Amount</th>
                <th className="px-3 py-3 font-bold">Fraud probability</th>
                <th className="px-5 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {report?.topAlerts.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 font-mono text-xs">
                    <Link href={`/alerts/${a.id}`} className="font-semibold text-brand-600 hover:underline">
                      {a.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2 tabular-nums">{fmtDateTime(a.createdAt)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtMoney(a.amount)}</td>
                  <td className="px-3 py-2.5">
                    <ProbabilityBar probability={a.probability} threshold={a.thresholdUsed} />
                  </td>
                  <td className="px-5 py-2.5">
                    <AlertStatusBadge status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report?.topAlerts.length === 0 && <EmptyState>No alerts in this period.</EmptyState>}
        </div>
      </Card>
      <p className="mt-3 text-xs text-ink-2">
        Counts come from the daily counters, which always equal a recount of the stored rows. Label-based figures judge each transaction at the threshold
        it was scored under.
      </p>
    </>
  );
}
