import { AppShell } from "@/ui/AppShell";
import { Demo } from "./Demo";
import { WasItYouDemo } from "./WasItYouDemo";
import { Hint } from "@/ui/Hint";
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
    <AppShell db={db} household={household} current="try" layout="rail">
      <h1 className="page-title">Try a payment</h1>
      <p className="lede" style={{ margin: "8px 0 24px" }}>
        Each one sends a real request through Spotter: the rules, an AI check that has to quote its evidence, and a real
        hold in the PayPal sandbox. No real money moves. Anything held waits for you on the dashboard.
      </p>
      <Hint q="What happens when I press Send it?">
        <ol className="hint-steps">
          <li>The request goes to Spotter as if that person asked to pay.</li>
          <li>Their rules run: weekly limit, ask me above, never allowed.</li>
          <li>Claude reads the message as untrusted text and must quote every warning word for word. Real shop prices come from Channel3.</li>
          <li>If it can go ahead, PayPal (sandbox) authorises the money. If it needs you, it waits on your dashboard. Nothing real moves.</li>
        </ol>
      </Hint>
      {household.demo && household.kind === "family" && <WasItYouDemo spotter={household.spotter_name} />}
      <Demo spenders={spenders} kind={household.kind} />
    </AppShell>
  );
}
