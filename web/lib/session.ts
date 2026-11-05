import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { RoleSchema, type Role } from "./schemas";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_S = 60 * 60 * 2;
const ISSUER = "fraud-detection";
const AUDIENCE = "fraud-detection-web";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Session {
  uid: string;
  email: string;
  role: Role;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_S,
};

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 random characters. See web/.env.example.");
  return new TextEncoder().encode(s);
}

/** A signed (HS256) JWT naming the user. Role and active status are read from the database on every request. */
export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secret());
}

/**
 * The signed-in user, or null. The JWT proves who they are; the users table decides what
 * they may do now — so a role change or deactivation takes effect on the next request.
 */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let userId: string | undefined;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    userId = payload.sub;
  } catch {
    return null; // bad signature, expired, wrong issuer/audience, or malformed
  }
  if (!userId || !UUID.test(userId)) return null;

  const { rows } = await db().query<{ id: string; email: string; role: string; active: boolean }>(
    "SELECT id, email, role, active FROM users WHERE id = $1",
    [userId],
  );
  const user = rows[0];
  const role = RoleSchema.safeParse(user?.role);
  if (!user || !user.active || !role.success) return null;
  return { uid: user.id, email: user.email, role: role.data };
}
