"use client";

import { Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { fetchAudit } from "@/lib/live";
import type { AuditEntry } from "@/lib/schemas";
import { fmtDateTime } from "./format";
import { Button, Card, EmptyState, PageHeader, inputClass, tableHeadRow } from "./ui";

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.logout": "Signed out",
  "alert.review": "Reviewed alert",
  "config.threshold": "Changed threshold",
  "config.seed": "Seeded configuration",
  "user.create": "Created user",
  "user.update": "Updated user",
  "user.reset": "Reset user (script)",
  "feedback.export": "Exported feedback",
};

/** before → after, one line per changed key. */
function Change({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]) || before === null);
  if (keys.length === 0) return <span className="text-muted">—</span>;
  const show = (v: unknown) => (v === undefined || v === null ? "∅" : typeof v === "string" ? v : JSON.stringify(v));
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {keys.map((k) => (
        <li key={k} className="break-all">
          <span className="font-semibold text-ink-2">{k}:</span>{" "}
          {before !== null && k in b && (
            <>
              <span className="text-muted line-through">{show(b[k])}</span> →{" "}
            </>
          )}
          <span className="font-semibold text-ink">{show(a[k])}</span>
        </li>
      ))}
    </ul>
  );
}

/** FR12: the append-only audit trail, newest first, filterable by action and actor. */
export function AuditLog() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    fetchAudit({ action, actor })
      .then((p) => {
        if (cancelled) return;
        setEntries(p.entries);
        setActions(p.actions);
        setNextBefore(p.nextBefore);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the audit log."));
    return () => {
      cancelled = true;
    };
  }, [action, actor]);

  async function more() {
    if (nextBefore === null) return;
    setLoadingMore(true);
    try {
      const p = await fetchAudit({ action, actor, before: nextBefore });
      setEntries((prev) => [...(prev ?? []), ...p.entries]);
      setNextBefore(p.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  function search(e: FormEvent) {
    e.preventDefault();
    setActor(actorInput.trim());
  }

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only — the database refuses to change or delete entries" />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select value={action} onChange={(e) => setAction(e.target.value)} className={`${inputClass} w-56! rounded-full! py-2! font-semibold shadow-card`} aria-label="Filter by action">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] ?? a}
            </option>
          ))}
        </select>
        <form onSubmit={search} className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            onBlur={() => setActor(actorInput.trim())}
            placeholder="Filter by email"
            aria-label="Filter by actor email"
            className={`${inputClass} w-64! rounded-full! py-2! pl-10! shadow-card`}
          />
        </form>
      </div>

      {error && <p className="mb-5 rounded-lg bg-banner px-4 py-3 text-sm text-critical">{error}</p>}

      <Card flush>
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className={tableHeadRow}>
                <th className="px-5 py-3 font-bold">When</th>
                <th className="px-3 py-3 font-bold">Who</th>
                <th className="px-3 py-3 font-bold">Action</th>
                <th className="px-3 py-3 font-bold">Target</th>
                <th className="px-5 py-3 font-bold">Change</th>
              </tr>
            </thead>
            <tbody>
              {entries?.map((e) => (
                <tr key={e.id} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-5 py-3 text-ink-2 tabular-nums">{fmtDateTime(e.at)}</td>
                  <td className="px-3 py-3">
                    <span className="block font-semibold">{e.actorEmail ?? "—"}</span>
                    {e.role && <span className="block text-xs capitalize text-ink-2">{e.role}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`font-bold ${e.action === "auth.login_failed" ? "text-critical" : "text-ink"}`}>{ACTION_LABEL[e.action] ?? e.action}</span>
                    <code className="block font-mono text-[11px] text-muted">{e.action}</code>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-ink-2">{e.target ?? "—"}</td>
                  <td className="max-w-[360px] px-5 py-3">
                    <Change before={e.before} after={e.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries === null && <EmptyState>Loading…</EmptyState>}
          {entries?.length === 0 && <EmptyState>No entries match.</EmptyState>}
        </div>
      </Card>
      {nextBefore !== null && (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" onClick={more} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load older entries"}
          </Button>
        </div>
      )}
    </>
  );
}
