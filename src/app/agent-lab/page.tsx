import { AppShell, type Section } from "@/ui/AppShell";
import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { DemoStart } from "@/ui/DemoStart";
import { getDeps } from "@/server/deps";
import { pageSession } from "@/server/page-session";
import { LAB_DAILY_RUNS } from "@/server/agent-lab";
import { Lab } from "./Lab";
import "./agent-lab.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hijack the agent | Spotter" };

const LEDE =
  "An AI agent shopping with the PayPal Agent Toolkit reads a shop page with a hidden line telling it to refund $200. Watch it try, and watch Spotter freeze it and release its PayPal hold.";

export default async function AgentLabPage() {
  const { db } = await getDeps();
  const s = await pageSession(db);
  if (!s) {
    // No sign in needed beyond the demo: one tap makes a demo family, then this page runs for it.
    return (
      <>
      <PublicHeader band signedIn={false} current="lab" />
      <main className="shell lab-public">
        <h1 className="page-title">Hijack the agent</h1>
        <p className="lede">{LEDE}</p>
        <p className="lab-honest">
          <b>A naive test agent, scripted,</b> so it falls for the trick every time. Real Claude refused it twice.
        </p>
        <DemoStart className="btn btn-primary" />
        <p className="lab-left">Free, no account. It opens your demo dashboard; come back to this page to run the agent.</p>
      </main>
      <PublicFooter band />
      </>
    );
  }
  const [row] = await db.query<{ n: string }>("select count(*)::text as n from lab_runs where household_id = $1 and at > now() - interval '1 day'", [s.household.id]);
  const runsLeft = Math.max(0, LAB_DAILY_RUNS - Number(row?.n ?? 0));
  return (
    <AppShell db={db} household={s.household} current={"try" as Section} layout="wide">
      <header className="lab-head">
        <h1 className="page-title">Hijack the agent</h1>
        <p className="lede">{LEDE}</p>
      </header>
      <Lab runsLeft={runsLeft} />
    </AppShell>
  );
}
