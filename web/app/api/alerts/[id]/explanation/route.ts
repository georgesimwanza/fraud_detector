import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { ScoringError, explain } from "@/lib/scoring";
import { getSession } from "@/lib/session";
import { getExplanationInput, saveExplanation } from "@/lib/store";

/**
 * Why was this alert raised? Integrated-gradients attributions from the inference service,
 * computed on first view (never on the ingest path, so NFR1 latency is untouched) and cached
 * when the model serving now is the model that scored the alert.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const input = await getExplanationInput(id);
  if (!input) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  if (input.explanation) return NextResponse.json({ explanation: input.explanation, scoredBy: input.modelVersion, sameModel: true });

  try {
    const explanation = await explain(input);
    const sameModel = explanation.modelVersion === input.modelVersion;
    if (sameModel) await saveExplanation(id, explanation);
    log("info", "alert_explained", { id, modelVersion: explanation.modelVersion, sameModel, residual: explanation.residual });
    return NextResponse.json({ explanation, scoredBy: input.modelVersion, sameModel });
  } catch (e) {
    if (!(e instanceof ScoringError)) throw e;
    log("warn", "explain_failed", { id, reason: e.message });
    return NextResponse.json({ error: `The inference service could not explain this alert (${e.message}).` }, { status: 503 });
  }
}
