import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { ThresholdSchema } from "@/lib/schemas";
import { getSession } from "@/lib/session";
import { setThreshold } from "@/lib/store";

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Only an admin can change the threshold." }, { status: 403 });

  const parsed = ThresholdSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Threshold must be a number between 0.01 and 0.99." }, { status: 400 });

  const config = await setThreshold(Math.round(parsed.data.threshold * 100) / 100, session);
  log("info", "threshold_changed", { threshold: config.threshold, by: session.uid });
  return NextResponse.json(config);
}
