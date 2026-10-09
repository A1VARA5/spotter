import { TopBar } from "@/ui/components";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";
import { listPayments, sweepStale } from "@/core/lifecycle";
import { Dashboard } from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard | Spotter" };

export default async function DashboardPage() {
  const { db } = await getDeps();
  const { household, unlocked } = await requirePageSession(db);
  await sweepStale(db);
  const names = Object.fromEntries((await listSpenders(db, household.id)).map((s) => [s.id, s.name]));
  const payments = await listPayments(db, household.id);
  return (
    <main className="shell">
      <TopBar current="dashboard" />
      <Dashboard names={names} unlocked={unlocked} initial={JSON.parse(JSON.stringify(payments))} />
    </main>
  );
}
