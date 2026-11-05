"use client";

import { Activity, ArrowRight, CircleCheck, ClipboardCheck, Clock, Gauge, ShieldAlert, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { subscribeAlerts, subscribeConnection, subscribeRecentTransactions, subscribeStats, subscribeTransactionsWithin, type Connection } from "@/lib/live";
import type { Alert, DailyStats, Transaction } from "@/lib/schemas";
import { fmtAgo, fmtClock, fmtCount, fmtMoney, fmtProb, fmtThreshold } from "./format";
import { AlertStatusBadge, Card, EmptyState, PageHeader, ProbabilityBar, RiskBadge, StatTile, SummaryBar, tableHeadRow } from "./ui";
import { useLive } from "./use-live";
import { VolumeChart } from "./volume-chart";

function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function GettingStarted() {
  const code = "block overflow-x-auto whitespace-pre rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-ink";
  return (
    <Card title="No transactions yet today" className="mb-6">
      <p className="text-sm text-ink-2">
        Nothing has been sent today. To generate traffic, run <code className="font-mono text-ink">start.bat sim</code>, or run the simulator from the repo
        root (synthetic rows until the dataset is downloaded):
      </p>
      <code className={`mt-3 ${code}`}>{`.venv\\Scripts\\python simulator\\simulate.py --synthetic --rate 3 --count 200 --fraud-share 0.1`}</code>
      <p className="mt-3 text-xs text-ink-2">
        This page updates on its own as transactions arrive. If they show <strong>Scoring failed</strong>, the inference service is not running: run{" "}
        <code className="font-mono">stop.bat</code> then <code className="font-mono">start.bat</code>.
      </p>
    </Card>
  );
}

/** FR8: recent alert activity — the newest alerts, whatever their status, live. */
function RecentAlerts({ alerts }: { alerts: Alert[] | undefined }) {
  return (
    <Card
      title="Recent alerts"
      className="flex h-full flex-col"
      action={
        <Link href="/alerts" className="inline-flex items-center gap-1 text-[13px] font-bold text-brand-600 hover:underline">
          View all <ArrowRight size={14} />
        </Link>
      }
    >
      {alerts?.length === 0 && <EmptyState>No alerts yet.</EmptyState>}
      <ul className="-mx-2 flex flex-col">
        {alerts?.map((a) => (
          <li key={a.id} className="row-new">
            <Link href={`/alerts/${a.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "var(--tile-coral-bg)", color: "var(--tile-coral-fg)" }}
              >
                <ShieldAlert size={17} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs font-semibold text-ink">{a.id}</span>
                <span className="block text-xs text-ink-2">
                  {fmtMoney(a.amount)} · {fmtProb(a.probability)} · {fmtAgo(a.createdAt)}
                </span>
              </span>
              <AlertStatusBadge status={a.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Dashboard() {
  const router = useRouter();
  const connection = useLive<Connection>(subscribeConnection, []);
  const stats = useLive<DailyStats>(subscribeStats, []);
  const recent = useLive<Transaction[]>((cb) => subscribeRecentTransactions(10, cb), []);
  const lastHalfHour = useLive<Transaction[]>((cb) => subscribeTransactionsWithin(30, cb), []);
  const recentAlerts = useLive<Alert[]>((cb) => subscribeAlerts("all", cb, "newest", 6), []);
  const openAlerts = useLive<Alert[]>((cb) => subscribeAlerts("open", cb, "newest", 10_000), []);

  const scored = stats ? stats.total - stats.scoringFailed : 0;
  const alertRate = stats && scored > 0 ? `${((stats.alerts / scored) * 100).toFixed(1)}%` : undefined;
  const avgLatency = stats && stats.total > 0 ? `${Math.round(stats.latencySumMs / stats.total)} ms` : "—";
  // Today's open alerts, so the strip agrees with the "Open alerts" tile.
  const openToday = openAlerts?.filter((a) => stats && localDay(a.createdAt) === stats.date);
  const openAmount = openToday?.reduce((sum, a) => sum + a.amount, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <span className="inline-flex items-center gap-2">
            {connection === "live" ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-good" />
              </span>
            ) : (
              <span className="h-2 w-2 rounded-full bg-warning" />
            )}
            {connection === "live" ? "Live" : connection === "reconnecting" ? "Reconnecting…" : "Connecting…"} · {stats ? `today, ${stats.date}` : "today"}
            {recent?.[0] && <> · last transaction {fmtClock(recent[0].receivedAt)}</>}
          </span>
        }
      />

      {stats?.total === 0 && <GettingStarted />}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Transactions today"
          value={stats ? fmtCount(stats.total) : "—"}
          tone="blue"
          icon={<Activity size={22} strokeWidth={2.4} />}
          footer={
            <>
              <Gauge size={16} className="text-[var(--tile-blue-fg)]" aria-hidden />
              <span>
                <strong className="font-bold text-ink">{avgLatency}</strong> avg latency
                {stats?.scoringFailed ? ` · ${stats.scoringFailed} unscored` : ""}
              </span>
            </>
          }
        />
        <StatTile
          label="Alerts raised"
          value={stats ? fmtCount(stats.alerts) : "—"}
          tone="coral"
          icon={<ShieldAlert size={22} strokeWidth={2.4} />}
          footer={
            <>
              <TrendingUp size={16} className="text-[var(--tile-coral-fg)]" aria-hidden />
              <span>
                <strong className="font-bold text-ink">{alertRate ?? "—"}</strong> of scored traffic
              </span>
            </>
          }
        />
        <Link href="/alerts" className="block rounded-xl transition-transform hover:-translate-y-0.5">
          <StatTile
            label="Open alerts"
            value={stats ? fmtCount(stats.open) : "—"}
            tone="amber"
            icon={<Clock size={22} strokeWidth={2.4} />}
            footer={
              <>
                <ArrowRight size={16} className="text-[var(--tile-amber-fg)]" aria-hidden />
                <span>Awaiting analyst review</span>
              </>
            }
          />
        </Link>
        <StatTile
          label="Reviewed today"
          value={stats ? fmtCount(stats.confirmedFraud + stats.falsePositive) : "—"}
          tone="teal"
          icon={<CircleCheck size={22} strokeWidth={2.4} />}
          footer={
            <>
              <ClipboardCheck size={16} className="text-[var(--tile-teal-fg)]" aria-hidden />
              <span>
                <strong className="font-bold text-ink">{stats?.confirmedFraud ?? 0}</strong> fraud ·{" "}
                <strong className="font-bold text-ink">{stats?.falsePositive ?? 0}</strong> false positive
              </span>
            </>
          }
        />
      </div>

      <div className="mt-5">
        <SummaryBar label="Payments held in today's open alerts" value={fmtMoney(openAmount)}>
          {openToday ? `${openToday.length} alert${openToday.length === 1 ? "" : "s"} raised today waiting for a decision` : "—"}
        </SummaryBar>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Scored transactions per minute · last 30 minutes">
          {lastHalfHour ? <VolumeChart transactions={lastHalfHour} /> : <div className="h-56" />}
        </Card>
        <RecentAlerts alerts={recentAlerts} />
      </div>

      <Card title="Latest transactions" className="mt-5" flush action={<span className="text-xs text-ink-2">updates as they arrive</span>}>
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={tableHeadRow}>
                <th className="px-5 py-3 font-bold">Received</th>
                <th className="px-3 py-3 font-bold">Transaction</th>
                <th className="px-3 py-3 text-right font-bold">Amount</th>
                <th className="px-3 py-3 font-bold">Fraud probability</th>
                <th className="px-3 py-3 font-bold">Risk</th>
                <th className="px-5 py-3 text-right font-bold">Threshold used</th>
              </tr>
            </thead>
            <tbody>
              {recent?.map((t) => (
                <tr
                  key={t.id}
                  onClick={t.isAlert ? () => router.push(`/alerts/${t.id}`) : undefined}
                  className={`row-new border-b border-line last:border-0 ${t.isAlert ? "cursor-pointer hover:bg-surface-2" : ""}`}
                >
                  <td className="px-5 py-3 text-ink-2 tabular-nums">{fmtClock(t.receivedAt)}</td>
                  <td className="px-3 py-3 font-mono text-xs">{t.externalId}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmtMoney(t.amount)}</td>
                  <td className="px-3 py-3">
                    <ProbabilityBar probability={t.probability} threshold={t.thresholdUsed} />
                  </td>
                  <td className="px-3 py-3">
                    <RiskBadge tx={t} />
                  </td>
                  <td className="px-5 py-3 text-right text-ink-2 tabular-nums">{fmtThreshold(t.thresholdUsed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
