import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { CreateUserSchema } from "@/lib/schemas";
import { getSession } from "@/lib/session";
import { StoreError, createUser, listUsers } from "@/lib/store";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (session.role !== "admin") return { error: NextResponse.json({ error: "Only an admin can manage users." }, { status: 403 }) };
  return { session };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json(await listUsers());
}

/** FR11: an admin creates an account. (The first admin still comes from scripts/create-user.ts.) */
export async function POST(req: Request) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  const parsed = CreateUserSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}` }, { status: 400 });
  }
  try {
    const id = await createUser({ email: parsed.data.email, role: parsed.data.role, passwordHash: await hash(parsed.data.password, 12) }, session);
    log("info", "user_created", { id, role: parsed.data.role, by: session.uid });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
