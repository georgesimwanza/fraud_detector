import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { Topbar } from "@/components/topbar";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const actor = { email: session.email, role: session.role };

  // White top bar across the full width (logo, search, alerts, account); navy sidebar beneath it.
  return (
    <div className="min-h-screen bg-page text-ink">
      <Topbar actor={actor} />
      <div className="flex flex-col md:flex-row">
        <Nav actor={actor} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
