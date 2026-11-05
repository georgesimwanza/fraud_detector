import { AlertsList } from "@/components/alerts-list";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  // key: a new search resets the status filter to "All".
  return <AlertsList key={query} query={query} />;
}
