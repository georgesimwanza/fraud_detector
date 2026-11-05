import { redirect } from "next/navigation";
import { AlertDetail } from "@/components/alert-detail";
import { getSession } from "@/lib/session";

export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  return <AlertDetail id={id} actor={{ email: session.email, role: session.role }} />;
}
