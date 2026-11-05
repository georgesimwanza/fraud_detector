import { NextResponse } from "next/server";
import { verifyIngestKey } from "@/lib/ingest-auth";
import { log } from "@/lib/log";
import { ingest } from "./ingest";

// One transaction: auth -> the shared pipeline (validate -> dedupe -> score -> classify -> persist) -> status code.
export async function POST(req: Request) {
  const started = performance.now();

  // 1. Ingest API key (constant-time against a stored hash).
  if (!verifyIngestKey(req.headers.get("x-api-key"))) {
    log("warn", "ingest_unauthorized");
    return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
  }

  const outcome = await ingest([await req.json().catch(() => undefined)], started);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error.message }, { status: outcome.error.status });

  const r = outcome.results[0];
  const latencyMs = Math.round(performance.now() - started);
  switch (r.status) {
    case "invalid":
      log("info", "ingest_rejected", { issues: r.issues.slice(0, 5) });
      return NextResponse.json({ error: "Invalid transaction.", issues: r.issues }, { status: 400 });
    case "duplicate":
      return NextResponse.json({ error: "Duplicate transaction ID.", id: r.id }, { status: 409 });
    case "scoring_failed":
      log("info", "ingested", { id: r.id, status: r.status, latencyMs });
      return NextResponse.json({ id: r.id, status: "scoring_failed", error: "Scoring unavailable; transaction stored unscored.", latencyMs }, { status: 503 });
    case "scored": {
      const { id, probability, riskLevel, isAlert, thresholdUsed, modelVersion } = r;
      log("info", "ingested", { id, status: r.status, probability, isAlert, threshold: thresholdUsed, modelVersion, latencyMs });
      return NextResponse.json({ id, status: "scored", probability, riskLevel, isAlert, thresholdUsed, modelVersion, latencyMs }, { status: 201 });
    }
  }
}
