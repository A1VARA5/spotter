import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { requirePageSession } from "@/server/page-session";
import { getSpender, listPayments, weekSpend } from "@/core/lifecycle";
import { TopBar } from "@/ui/components";
import { money, STATE_LABEL, trackState } from "@/ui/format";
import { Connect } from "./Connect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Person | Spotter" };

const KIND: Record<string, string> = { person: "Relative", kid: "Kid", agent: "AI agent" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const { household, unlocked } = await requirePageSession(db);
  if (!unlocked) redirect("/dashboard?unlock=people");
  const spender = await getSpender(db, (await params).id);
  if (!spender || spender.household_id !== household.id) notFound();
  const { weekly, askAbove, blockedCategories } = spender.allowance;
  const used = await weekSpend(db, spender.id, weekly.currency);
  const recent = (await listPayments(db, household.id, 200)).filter((p) => p.spender_id === spender.id).slice(0, 8);
  return (
    <main className="shell" style={{ paddingBottom: 64 }}>
      <TopBar current="dashboard" />
      <p className="person-crumb">
        <a href="/dashboard">Dashboard</a> / {KIND[spender.kind] ?? spender.kind}
      </p>
      <h1 className="page-title">{spender.name}</h1>
      <dl className="allowance">
        <div>
          <dt>Spent this week</dt>
          <dd className="num">
            {money(used, weekly.currency)} <span>of {money(weekly.amount, weekly.currency)}</span>
          </dd>
        </div>
        <div>
          <dt>Asks you above</dt>
          <dd className="num">{money(askAbove.amount, askAbove.currency)}</dd>
        </div>
        <div>
          <dt>Never allowed</dt>
          <dd>{blockedCategories.map((c) => c.replace(/_/g, " ")).join(", ") || "Nothing"}</dd>
        </div>
      </dl>
      <h2 className="section-title">How {spender.name} reaches Spotter</h2>
      <Connect
        spender={{ id: spender.id, name: spender.name, kind: spender.kind, email: spender.email, telegram: spender.telegram_chat_id }}
        inbox={process.env.AGENTBOXD_INBOX_ADDRESS ?? null}
        telegramBot={process.env.TELEGRAM_BOT_USERNAME ?? null}
      />
      <h2 className="section-title">Recent payments</h2>
      {recent.length === 0 ? (
        <p className="lede">Nothing yet. Their payments show up here as soon as they ask to pay.</p>
      ) : (
        <ul className="people-list">
          {recent.map((p) => (
            <li key={p.id} className="person-row">
              <span className="person-name">{p.request.payee.name}</span>
              <span className="person-kind num">{money(p.amount, p.currency)}</span>
              <span className="feed-state" data-state={trackState(p.status)}>{STATE_LABEL[trackState(p.status)]}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
