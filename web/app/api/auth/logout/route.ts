import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSession, sessionCookieOptions } from "@/lib/session";
import { recordAudit } from "@/lib/store";

export async function POST(req: Request) {
  const session = await getSession();
  if (session) await recordAudit({ actorId: session.uid, actorEmail: session.email, role: session.role, action: "auth.logout" });
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
