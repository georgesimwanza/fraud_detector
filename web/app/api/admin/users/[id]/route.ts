import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { UpdateUserSchema } from "@/lib/schemas";
import { getSession } from "@/lib/session";
import { StoreError, updateUser } from "@/lib/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FR11: change a user's role, deactivate/reactivate them, or reset their password. Applies on their next request. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Only an admin can manage users." }, { status: 403 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "User not found." }, { status: 404 });
  const parsed = UpdateUserSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.path.length ? `${issue.path.join(".")}: ${issue.message}` : (issue?.message ?? "Invalid change.") }, { status: 400 });
  }

  const { role, active, password } = parsed.data;
  try {
    await updateUser(id, { role, active, passwordHash: password ? await hash(password, 12) : undefined }, session);
    log("info", "user_updated", { id, role, active, passwordReset: Boolean(password), by: session.uid });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
