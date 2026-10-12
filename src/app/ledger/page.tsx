import { AppShell } from "@/ui/AppShell";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";
import { listPayments } from "@/core/lifecycle";
import { Ledger } from "./Ledger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ledger | Spotter" };

export default async function LedgerPage() {
  const { db } = await getDeps();
  const { household, unlocked } = await requirePageSession(db);
  const names = Object.fromEntries((await listSpenders(db, household.id, { lab: true })).map((s) => [s.id, s.name]));
  const payments = await listPayments(db, household.id, 500, { lab: true });
  return (
    <AppShell db={db} household={household} current="activity" layout="wide">
      <h1 className="page-title">Activity</h1>
      <p className="lede" style={{ margin: "8px 0 20px" }}>
        Every payment Spotter has seen: who asked, what happened, why, what real shops charge, and the PayPal id.
        {household.demo && " The made up Sample month on Watchtower isn't listed here."}
      </p>
      <Ledger names={names} payments={JSON.parse(JSON.stringify(payments))} />
    </AppShell>
  );
}
