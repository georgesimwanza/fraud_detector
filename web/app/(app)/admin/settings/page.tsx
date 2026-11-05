import { redirect } from "next/navigation";
import { ThresholdForm } from "@/components/threshold-form";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function SettingsPage() {
  // Server-side role check — the real boundary; middleware only checks the cookie exists.
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    return (
      <>
        <PageHeader title="Settings" />
        <p className="text-sm text-ink-2">You need the admin role to change system settings.</p>
      </>
    );
  }
  return <ThresholdForm />;
}
