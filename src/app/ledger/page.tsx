import { TopBar } from "@/ui/components";
import { getDeps } from "@/server/deps";
import { listPayments } from "@/core/lifecycle";
import { Ledger } from "./Ledger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ledger | Spotter" };

export default async function LedgerPage() {
  const { db } = await getDeps();
  const payments = await listPayments(db, 500);
  return (
    <main className="shell" style={{ paddingBottom: 64 }}>
      <TopBar current="ledger" />
      <h1 className="page-title">Ledger</h1>
      <p className="lede" style={{ margin: "8px 0 20px" }}>
        Every payment Spotter has seen: who asked, what happened, why, what real shops charge, and the PayPal id.
      </p>
      <Ledger payments={JSON.parse(JSON.stringify(payments))} />
    </main>
  );
}
