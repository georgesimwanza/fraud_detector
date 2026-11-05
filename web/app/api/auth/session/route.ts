import { compare, hashSync } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { LoginSchema } from "@/lib/schemas";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/session";
import { findUserByEmail, recordAudit } from "@/lib/store";

// Never reveal which field was wrong.
const GENERIC_ERROR = "Invalid email or password.";

// Compared against when the email is unknown, so a miss costs the same bcrypt time as a hit.
const DUMMY_HASH = hashSync(randomBytes(16).toString("hex"), 12);

export async function POST(req: Request) {
  const parsed = LoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });

  const email = parsed.data.email.toLowerCase();
  const user = await findUserByEmail(email);
  const passwordOk = await compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk || !user.active) {
    const reason = !user ? "unknown_email" : !passwordOk ? "wrong_password" : "inactive";
    await recordAudit({ actorId: user?.id ?? null, actorEmail: email, role: null, action: "auth.login_failed", after: { reason } });
    log("warn", "login_failed", { reason });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  await recordAudit({ actorId: user.id, actorEmail: user.email, role: user.role, action: "auth.login" });
  log("info", "login", { uid: user.id, role: user.role });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
  return res;
}
