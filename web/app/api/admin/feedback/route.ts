import { toCsv } from "@/lib/analytics";
import { FEATURE_ORDER } from "@/lib/schemas";
import { getSession } from "@/lib/session";
import { listFeedback, recordAudit } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Analyst decisions as training labels: every reviewed alert's features in creditcard.csv column
 * order, with Class = 1 for confirmed fraud and 0 for a false positive.
 *
 * Caution for retraining: rows replayed by the simulator come from the TEST split. Adding them to
 * training data would leak the test set — use feedback only from traffic the model has never been
 * evaluated on.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });
  if (session.role !== "admin") return new Response("Only an admin can export feedback.", { status: 403 });

  const rows = await listFeedback();
  await recordAudit({ actorId: session.uid, actorEmail: session.email, role: session.role, action: "feedback.export", after: { rows: rows.length } });

  const csv = toCsv(
    [...FEATURE_ORDER, "Class", "transaction_id", "decision", "reviewed_at", "model_version", "dataset_label"],
    rows.map((r) => [
      r.time,
      ...r.v,
      r.amount,
      r.decision === "confirmed_fraud" ? 1 : 0,
      r.id,
      r.decision,
      new Date(r.reviewedAt).toISOString(),
      r.modelVersion,
      r.datasetLabel,
    ]),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analyst-feedback-${stamp}.csv"` },
  });
}
