import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listAudit, listAuditActions } from "@/lib/store";

export const dynamic = "force-dynamic";

const PAGE = 50;

/** FR12: the audit trail, newest first. ?action=&actor=&before=<id> (keyset pagination). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Only an admin can view the audit log." }, { status: 403 });

  const url = new URL(req.url);
  const action = url.searchParams.get("action")?.slice(0, 64) || undefined;
  const actor = url.searchParams.get("actor")?.trim().slice(0, 254) || undefined;
  const beforeRaw = url.searchParams.get("before");
  const beforeId = beforeRaw && /^\d{1,18}$/.test(beforeRaw) ? Number(beforeRaw) : undefined;

  const [entries, actions] = await Promise.all([listAudit({ action, actor, beforeId, limit: PAGE + 1 }), listAuditActions()]);
  const more = entries.length > PAGE;
  const page = entries.slice(0, PAGE);
  return NextResponse.json({ entries: page, actions, nextBefore: more ? page[page.length - 1].id : null });
}
