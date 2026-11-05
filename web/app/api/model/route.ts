import { NextResponse } from "next/server";
import { driftReport, performanceAt, reviewFeedback, shadowComparison } from "@/lib/analytics";
import type { ModelHealth } from "@/lib/schemas";
import { getSession } from "@/lib/session";
import { StoreError, getConfig, getDriftWindows, getLabelledScores, getModelInfo, getReviewCounts, getShadowRows } from "@/lib/store";

export const dynamic = "force-dynamic";

const DRIFT_WINDOW = 1_000;

/** Model health for the active model: live performance, analyst feedback, drift, and any shadow model. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let config;
  try {
    config = await getConfig();
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const version = config.activeModelVersion;
  const [info, labelled, reviews, windows, shadowRows] = await Promise.all([
    getModelInfo(version),
    getLabelledScores(version),
    getReviewCounts(version),
    getDriftWindows(version, DRIFT_WINDOW),
    getShadowRows(version),
  ]);

  const health: ModelHealth = {
    config,
    suggestedThreshold: info.suggestedThreshold,
    trainingMetrics: info.metrics,
    live: performanceAt(labelled, config.threshold),
    feedback: reviewFeedback(reviews),
    drift: driftReport(version, windows.reference, windows.current),
    shadow: shadowComparison(version, shadowRows, config.threshold),
  };
  return NextResponse.json(health);
}
