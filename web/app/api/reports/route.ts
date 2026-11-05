import { NextResponse } from "next/server";
import { buildReport, toCsv } from "@/lib/analytics";
import { ReportQuerySchema } from "@/lib/schemas";
import { getSession } from "@/lib/session";
import { getReportData } from "@/lib/store";

/** FR10: fraud statistics for a period. ?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv] */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const parsed = ReportQuerySchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid period." }, { status: 400 });
  const { from, to } = parsed.data;

  const report = buildReport(from, to, await getReportData(from, to));
  if (url.searchParams.get("format") !== "csv") return NextResponse.json(report);

  const csv = toCsv(
    ["date", "transactions", "scoring_failed", "alerts", "open", "confirmed_fraud", "false_positive", "alert_amount", "confirmed_fraud_amount", "avg_latency_ms"],
    report.days.map((d) => [
      d.date,
      d.total,
      d.scoringFailed,
      d.alerts,
      d.open,
      d.confirmedFraud,
      d.falsePositive,
      d.alertAmount.toFixed(2),
      d.confirmedFraudAmount.toFixed(2),
      d.total > 0 ? Math.round(d.latencySumMs / d.total) : null,
    ]),
  );
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fraud-report-${from}-to-${to}.csv"` },
  });
}
