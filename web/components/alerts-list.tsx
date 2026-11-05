"use client";

import { ArrowDownUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { subscribeAlerts } from "@/lib/live";
import { ALERT_SORTS, type Alert, type AlertSort, type AlertStatus } from "@/lib/schemas";
import { fmtAgo, fmtDateTime, fmtMoney } from "./format";
import { AlertStatusBadge, Card, EmptyState, PageHeader, ProbabilityBar, Segmented, tableHeadRow } from "./ui";
import { useLive } from "./use-live";

const FILTERS: { value: AlertStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "confirmed_fraud", label: "Confirmed fraud" },
  { value: "false_positive", label: "False positive" },
  { value: "all", label: "All" },
];

export function AlertsList({ query = "" }: { query?: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<AlertStatus | "all">(query ? "all" : "open");
  const [sort, setSort] = useState<AlertSort>("newest");
  const alerts = useLive<Alert[]>((cb) => subscribeAlerts(filter, cb, sort), [filter, sort]);
  const q = query.trim().toLowerCase();
  const shown = q ? alerts?.filter((a) => a.id.toLowerCase().includes(q)) : alerts;

  return (
    <>
      <PageHeader title="Alerts" subtitle="Transactions scored at or above the threshold they were judged under" />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented label="Filter by status" value={filter} onChange={setFilter} options={FILTERS} />
        <label className="ml-auto inline-flex items-center gap-2 rounded-full bg-surface px-4 py-1.5 text-[13px] font-semibold text-ink-2 shadow-card">
          <ArrowDownUp size={14} aria-hidden />
          <span className="sr-only">Sort alerts</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as AlertSort)} className="bg-transparent font-bold text-ink outline-none">
            {Object.entries(ALERT_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {q && (
          <Link href="/alerts" className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[13px] font-bold text-brand-700 hover:bg-brand-100">
            ID contains “{query}” <X size={14} aria-label="Clear search" />
          </Link>
        )}
      </div>

      <Card flush>
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className={tableHeadRow}>
                <th className="px-5 py-3 font-bold" aria-sort={sort === "newest" ? "descending" : sort === "oldest" ? "ascending" : undefined}>
                  Raised
                </th>
                <th className="px-3 py-3 font-bold">Alert</th>
                <th className="px-3 py-3 text-right font-bold" aria-sort={sort === "amount" ? "descending" : undefined}>
                  Amount
                </th>
                <th className="px-3 py-3 font-bold" aria-sort={sort === "probability" ? "descending" : undefined}>
                  Fraud probability
                </th>
                <th className="px-3 py-3 font-bold">Status</th>
                <th className="px-5 py-3 font-bold">Reviewed by</th>
              </tr>
            </thead>
            <tbody>
              {shown?.map((a) => (
                <tr key={a.id} onClick={() => router.push(`/alerts/${a.id}`)} className="row-new cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-5 py-3 text-ink-2 tabular-nums" title={fmtDateTime(a.createdAt)}>
                    {fmtAgo(a.createdAt)}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">
                    <Link href={`/alerts/${a.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand-600 hover:underline">
                      {a.id}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmtMoney(a.amount)}</td>
                  <td className="px-3 py-3">
                    <ProbabilityBar probability={a.probability} threshold={a.thresholdUsed} />
                  </td>
                  <td className="px-3 py-3">
                    <AlertStatusBadge status={a.status} />
                  </td>
                  <td className="px-5 py-3 text-ink-2">{a.reviewedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown?.length === 0 && (
            <EmptyState>{q ? "No alerts match that ID." : filter === "open" ? "No open alerts — the queue is clear." : "No alerts with this status yet."}</EmptyState>
          )}
        </div>
      </Card>
      <p className="mt-3 text-xs text-ink-2">Showing up to 200 alerts from the latest 500 loaded when this page connected, plus every alert raised since.</p>
    </>
  );
}
