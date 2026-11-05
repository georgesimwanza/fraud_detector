import { NextResponse } from "next/server";
import { thresholdCurve } from "@/lib/analytics";
import { getSession } from "@/lib/session";
import { StoreError, getConfig, getLabelledScores } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * What-if data for the threshold: confusion counts at every settable threshold, over the active
 * model's scored transactions that carry an evaluation label (the simulator sends the dataset's).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const config = await getConfig();
    const scores = await getLabelledScores(config.activeModelVersion);
    return NextResponse.json({
      modelVersion: config.activeModelVersion,
      n: scores.length,
      positives: scores.filter((s) => s.label === 1).length,
      points: thresholdCurve(scores),
    });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
