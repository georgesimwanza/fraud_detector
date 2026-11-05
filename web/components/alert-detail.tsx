"use client";

import { BrainCircuit, ClipboardCheck, Gauge, ListOrdered, Receipt, ShieldAlert, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchExplanation, reviewAlert, subscribeAlert, subscribeTransaction, type ExplanationResult } from "@/lib/live";
import type { Actor, Alert, Decision, Transaction } from "@/lib/schemas";
import { ExplanationChart } from "./explanation-chart";
import { fmtDateTime, fmtMoney, fmtProb, fmtThreshold } from "./format";
import { AlertStatusBadge, Button, Card, IconTile, PageHeader, SummaryBar, alertStatusLabel, inputClass, labelClass } from "./ui";
import { useLive } from "./use-live";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** One boxed figure in a soft tile, like the reference's "Current age 30" tiles. */
function Figure({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <div className="text-xs font-semibold text-ink-2">{label}</div>
      <div className="mt-2 inline-block rounded-md bg-surface px-3 py-1.5 text-lg font-extrabold text-ink ring-1 ring-line tabular-nums">{value}</div>
      {note && <div className="mt-2 text-xs text-ink-2">{note}</div>}
    </div>
  );
}

function ScoreMeter({ probability, threshold }: { probability: number; threshold: number }) {
  return (
    <div>
      <div className="relative h-2.5 rounded-full bg-track">
        <div className="absolute inset-y-0 left-0 rounded-full bg-critical" style={{ width: `${probability * 100}%` }} />
        <div className="absolute -top-1.5 h-5.5 w-0.5 bg-ink" style={{ left: `${threshold * 100}%` }} />
      </div>
      <div className="relative mt-1 h-4 text-xs text-ink-2">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${threshold * 100}%` }}>
          threshold {fmtThreshold(threshold)}
        </span>
      </div>
    </div>
  );
}

function WhyFlagged({ id }: { id: string }) {
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchExplanation(id)
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the explanation."));
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  return (
    <Card id="why" title="Why it was flagged">
      {error ? (
        <div className="text-sm">
          <p className="text-critical">{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : !result ? (
        <p className="text-sm text-ink-2">Asking the model which features drove this score…</p>
      ) : (
        <>
          {!result.sameModel && (
            <p className="mb-3 rounded-lg bg-banner px-3 py-2 text-xs text-ink">
              This alert was scored by <code className="font-mono">{result.scoredBy}</code>, but the model serving now is{" "}
              <code className="font-mono">{result.explanation.modelVersion}</code>. The breakdown below explains today&apos;s model and is not saved.
            </p>
          )}
          <ExplanationChart explanation={result.explanation} />
        </>
      )}
    </Card>
  );
}

function DecisionPanel({ alert, actor }: { alert: Alert; actor: Actor }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const isOpen = alert.status === "open";
  const canAct = isOpen || actor.role === "admin";

  async function decide(decision: Decision) {
    setPending(decision);
    setError(null);
    setDone(null);
    try {
      await reviewAlert(alert.id, decision, note);
      setNote("");
      setDone(`Recorded as ${alertStatusLabel(decision).toLowerCase()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the decision.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card id="decision" title={isOpen ? "Decision" : "Review"}>
      {!isOpen && (
        <dl className="mb-4">
          <Row label="Decision">
            <AlertStatusBadge status={alert.status} />
          </Row>
          <Row label="By">{alert.reviewedBy}</Row>
          {alert.reviewedAt && <Row label="At">{fmtDateTime(alert.reviewedAt)}</Row>}
          {alert.note && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">{alert.note}</p>}
        </dl>
      )}

      {canAct ? (
        <>
          {!isOpen && <p className="mb-3 text-xs text-ink-2">As an admin you can change this decision. The change is audit-logged.</p>}
          <label className={labelClass}>
            Note <span className="font-normal text-ink-2">(optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="What did you check?"
              className={`mt-1.5 ${inputClass}`}
            />
          </label>
          <div className="mt-4 flex flex-col gap-2.5">
            <Button variant="danger" onClick={() => decide("confirmed_fraud")} disabled={pending !== null || alert.status === "confirmed_fraud"}>
              {pending === "confirmed_fraud" ? "Saving…" : "Confirm fraud"}
            </Button>
            <Button variant="secondary" onClick={() => decide("false_positive")} disabled={pending !== null || alert.status === "false_positive"}>
              {pending === "false_positive" ? "Saving…" : "Mark false positive"}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-2">This alert has been reviewed. Only an admin can change the decision.</p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="mt-3 text-sm text-ink">
          ✓ {done}
        </p>
      )}
    </Card>
  );
}

const SECTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "#score", label: "Risk score", icon: Gauge },
  { href: "#why", label: "Why it was flagged", icon: BrainCircuit },
  { href: "#transaction", label: "Transaction", icon: Receipt },
  { href: "#features", label: "PCA features", icon: ListOrdered },
  { href: "#decision", label: "Decision", icon: ClipboardCheck },
];

function Profile({ alert }: { alert: Alert }) {
  return (
    <Card>
      <div className="flex flex-col items-center pt-2 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[conic-gradient(from_200deg,#6a86ff,#3f56ec,#6a86ff)] p-1">
          <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-critical">
            <ShieldAlert size={34} strokeWidth={2} aria-hidden />
          </span>
        </span>
        <h1 className="mt-3 break-all font-mono text-[15px] font-bold text-ink">{alert.id}</h1>
        <div className="mt-1 text-sm font-semibold text-ink-2 tabular-nums">{fmtMoney(alert.amount)}</div>
        <div className="mt-0.5 text-xs text-muted">Raised {fmtDateTime(alert.createdAt)}</div>
        <div className="mt-3">
          <AlertStatusBadge status={alert.status} />
        </div>
      </div>
      <nav className="mt-5 flex flex-col gap-1 border-t border-line pt-4" aria-label="Sections">
        {SECTIONS.map(({ href, label, icon: Icon }) => (
          <a key={href} href={href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] font-semibold text-ink hover:bg-surface-2 hover:shadow-card">
            <IconTile tone="blue" size="h-8 w-8">
              <Icon size={16} aria-hidden />
            </IconTile>
            {label}
          </a>
        ))}
      </nav>
    </Card>
  );
}

export function AlertDetail({ id, actor }: { id: string; actor: Actor }) {
  const alert = useLive<Alert | null>((cb) => subscribeAlert(id, cb), [id]);
  const tx = useLive<Transaction | null>((cb) => subscribeTransaction(id, cb), [id]);
  const back = { href: "/alerts", label: "Alert list" };

  if (alert === undefined) return <PageHeader title="Alert" back={back} />;
  if (alert === null) {
    return (
      <>
        <PageHeader title="Alert not found" back={back} />
        <p className="text-sm text-ink-2">
          No alert has the ID <code className="font-mono">{id}</code>.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Alert review" back={back} />

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5 lg:sticky lg:top-22 lg:self-start">
          <Profile alert={alert} />
          <DecisionPanel alert={alert} actor={actor} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card id="score" title="Risk score">
            <div className="grid gap-4 sm:grid-cols-3">
              <Figure label="Fraud probability" value={fmtProb(alert.probability)} note="at or above the threshold" />
              <Figure label="Threshold used" value={fmtThreshold(alert.thresholdUsed)} note="when the alert was raised" />
              <Figure label="Model" value={<code className="font-mono text-sm">{alert.modelVersion}</code>} note="scored this transaction" />
            </div>
            <div className="mt-5">
              <ScoreMeter probability={alert.probability} threshold={alert.thresholdUsed} />
            </div>
          </Card>

          <SummaryBar label="Payment amount under review" value={fmtMoney(alert.amount)}>
            {tx?.label !== undefined && <>Dataset label (evaluation only): {tx.label === 1 ? "1 · fraud" : "0 · legitimate"}</>}
          </SummaryBar>

          <WhyFlagged id={alert.id} />

          <Card id="transaction" title="Transaction">
            <dl>
              <Row label="External ID">
                <code className="font-mono text-xs">{tx?.externalId ?? alert.transactionId}</code>
              </Row>
              <Row label="Amount">{fmtMoney(alert.amount)}</Row>
              {tx && (
                <>
                  <Row label="Time feature">{tx.time.toLocaleString("en-US")} s</Row>
                  <Row label="Received">{fmtDateTime(tx.receivedAt)}</Row>
                  <Row label="End-to-end latency">{tx.latencyMs} ms</Row>
                  {tx.shadowProbability !== null && (
                    <Row label={`Shadow model (${tx.shadowModelVersion})`}>{fmtProb(tx.shadowProbability)} · not used for alerts</Row>
                  )}
                </>
              )}
            </dl>
          </Card>

          {tx && (
            <Card id="features" title="PCA features V1–V28">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                {tx.v.map((value, i) => (
                  <div key={i} className="flex justify-between gap-2 border-b border-line py-1.5">
                    <span className="text-ink-2">V{i + 1}</span>
                    <span className="font-mono tabular-nums">{value.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
