import { TopBar } from "@/ui/components";
import { getDeps } from "@/server/deps";
import { listPayments } from "@/core/lifecycle";
import { Dashboard } from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard | Spotter" };

export default async function DashboardPage() {
  const { db } = await getDeps();
  const payments = await listPayments(db);
  return (
    <main className="shell">
      <TopBar current="dashboard" />
      <Dashboard initial={JSON.parse(JSON.stringify(payments))} />
    </main>
  );
}
