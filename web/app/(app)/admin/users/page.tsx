import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { UsersAdmin } from "@/components/users-admin";
import { getSession } from "@/lib/session";

export default async function UsersPage() {
  // Server-side role check — the real boundary; middleware only checks the cookie exists.
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    return (
      <>
        <PageHeader title="Users" />
        <p className="text-sm text-ink-2">You need the admin role to manage users.</p>
      </>
    );
  }
  return <UsersAdmin selfEmail={session.email} />;
}
