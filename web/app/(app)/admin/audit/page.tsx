import { redirect } from "next/navigation";
import { AuditLog } from "@/components/audit-log";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function AuditPage() {
  // Server-side role check — the real boundary; middleware only checks the cookie exists.
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    return (
      <>
        <PageHeader title="Audit log" />
        <p className="text-sm text-ink-2">You need the admin role to view the audit log.</p>
      </>
    );
  }
  return <AuditLog />;
}
