import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const tab = ["overview", "history", "favorites", "api", "payments"].includes(params.tab ?? "")
    ? (params.tab as "overview" | "history" | "favorites" | "api" | "payments")
    : "overview";
  return <DashboardClient initialTab={tab} />;
}
