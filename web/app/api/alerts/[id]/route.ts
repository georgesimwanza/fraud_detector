import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { ReviewSchema } from "@/lib/schemas";
import { getSession } from "@/lib/session";
import { StoreError, reviewAlert } from "@/lib/store";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = ReviewSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision." }, { status: 400 });

  const { id } = await params;
  try {
    const alert = await reviewAlert(id, parsed.data.decision, parsed.data.note, session);
    log("info", "alert_reviewed", { id, decision: alert.status, by: session.uid, role: session.role });
    return NextResponse.json(alert);
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
