import { TopBar } from "@/ui/components";
import { Demo } from "./Demo";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";

export const dynamic = "force-dynamic";

export const metadata = { title: "Try it | Spotter" };

export default async function DemoPage() {
  const { db } = await getDeps();
  const { household } = await requirePageSession(db);
  const spenders = (await listSpenders(db, household.id)).map(({ id, name, kind }) => ({ id, name, kind }));
  return (
    <main className="shell" style={{ paddingBottom: 64 }}>
      <TopBar current="demo" />
      <h1 className="page-title">Try it</h1>
      <p className="lede" style={{ margin: "8px 0 24px" }}>
        Each one sends a real request through Spotter: the rules, an AI check that has to quote its evidence, and a real
        hold in the PayPal sandbox. No real money moves. Anything held waits for you on the dashboard.
      </p>
      <Demo spenders={spenders} />
    </main>
  );
}
