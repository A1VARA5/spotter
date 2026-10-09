import Link from "next/link";
import { Check } from "lucide-react";
import { AppShell } from "@/ui/AppShell";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";
import { listPayments, reconcileStuck, sweepStale } from "@/core/lifecycle";
import { Dashboard } from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard | Spotter" };

export default async function DashboardPage() {
  const deps = await getDeps();
  const { db } = deps;
  const { household, unlocked } = await requirePageSession(db);
  await sweepStale(db);
  await reconcileStuck(deps);
  const spenders = await listSpenders(db, household.id);
  const names = Object.fromEntries(spenders.map((s) => [s.id, s.name]));
  const payments = await listPayments(db, household.id);
  const [tokens] = await db.query<{ n: string }>(
    "select count(*)::text as n from agent_tokens t join spenders s on s.id = t.spender_id where s.household_id = $1 and t.revoked_at is null",
    [household.id],
  );
  const firstToConnect = spenders.find((s) => !s.email && !s.telegram_chat_id);

  // The first run, as a checklist that ticks itself from real state and disappears when done.
  const steps = [
    { done: spenders.length > 0, label: "Add the people you look out for", href: "/setup?step=people" },
    {
      done: spenders.some((s) => s.email || s.telegram_chat_id) || Number(tokens?.n ?? 0) > 0,
      label: "Connect one of them by email, Telegram or as an AI agent",
      href: firstToConnect ? `/people/${firstToConnect.id}` : "/setup?step=connect",
    },
    { done: Boolean(household.alert_email), label: "Tell Spotter where to email you", href: "/account" },
    { done: payments.length > 0, label: "See a payment get checked (try one with fake money)", href: "/demo" },
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <AppShell db={db} household={household} current="waiting">
      {left > 0 && (
        <section className="start-list" aria-labelledby="start-title">
          <h2 id="start-title" className="start-title">
            Getting started: {steps.length - left} of {steps.length} done
          </h2>
          <ol className="start-steps">
            {steps.map((s) => (
              <li key={s.label} data-done={s.done}>
                <span className="start-tick" aria-hidden="true">
                  {s.done && <Check size={14} strokeWidth={3} />}
                </span>
                {s.done ? <span className="start-done">{s.label}</span> : <Link href={s.href}>{s.label}</Link>}
                <span className="sr-only">{s.done ? " (done)" : ""}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {spenders.length > 0 && (
        <nav className="people-strip mobile-only" aria-label="Your people">
          {spenders.map((s) => (
            <Link key={s.id} href={`/people/${s.id}`} className="person-chip">
              <span className="person-chip-name">{s.name}</span>
            </Link>
          ))}
          <Link href="/setup?step=people" className="person-chip person-chip-add">
            Add someone
          </Link>
        </nav>
      )}
      <Dashboard names={names} unlocked={unlocked} initial={JSON.parse(JSON.stringify(payments))} />
    </AppShell>
  );
}
