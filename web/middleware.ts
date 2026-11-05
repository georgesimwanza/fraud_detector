import { NextResponse, type NextRequest } from "next/server";

// Presence check only — a convenience redirect, not a security boundary.
// Server code verifies the session and checks roles on every request.
export function middleware(req: NextRequest) {
  if (req.cookies.has("session")) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = new URL("/login", req.url);
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Public: the landing page ("/" — `.+` never matches it), login, static assets.
  // /api/transactions authenticates with the ingest API key, not a session.
  matcher: ["/((?!login|api/auth|api/transactions|_next/|favicon.ico|dashboard-preview.png).+)"],
};
