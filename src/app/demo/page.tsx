import Link from "next/link";
import { AppShell } from "@/ui/AppShell";
import { Demo } from "./Demo";
import { WasItYouDemo } from "./WasItYouDemo";
import { Hint } from "@/ui/Hint";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";
import { openExampleAsk } from "@/server/was-it-you";

export const dynamic = "force-dynamic";

export const metadata = { title: "Try it | Spotter" };

export default async function DemoPage() {
  const { db } = await getDeps();
  const { household } = await requirePageSession(db);
  const spenders = (await listSpenders(db, household.id)).map(({ id, name, kind }) => ({ id, name, kind }));
  return (
    <AppShell db={db} household={household} current="try">
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
          <li>If it&apos;s held or stopped, Spotter looks into it: links and shop pages open in a cloud browser (KERNEL), never on anyone&apos;s phone.</li>
        </ol>
        <p>
          <Link href="/checks">How Spotter checked it</Link> shows each of these on your own payments.
        </p>
      </Hint>
      {household.demo && household.kind === "family" && <WasItYouDemo spotter={household.spotter_name} resume={await openExampleAsk(db, household.id).catch((e) => {
            // Resuming is a nicety: the demo still starts fresh, and the dashboard can answer the old one.
            console.error(`[spotter] couldn't look up an open example ask for ${household.id}:`, e);
            return null;
          })} />}
      <Demo spenders={spenders} kind={household.kind} />
    </AppShell>
  );
}
