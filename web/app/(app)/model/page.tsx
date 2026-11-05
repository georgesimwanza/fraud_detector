import { redirect } from "next/navigation";
import { ModelHealthView } from "@/components/model-health";
import { getSession } from "@/lib/session";

export default async function ModelPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <ModelHealthView actor={{ email: session.email, role: session.role }} />;
}
