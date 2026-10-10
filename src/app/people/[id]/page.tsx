import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { requirePageSession } from "@/server/page-session";
import { getSpender, listPayments, weekSpend } from "@/core/lifecycle";
import { hasAgentToken } from "@/core/pairing";
import { AppShell } from "@/ui/AppShell";
import { money, STATE_LABEL, trackState } from "@/ui/format";
import { Connect } from "./Connect";
import { Hint } from "@/ui/Hint";
import { labelsFor } from "@/ui/labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Person | Spotter" };

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
    <AppShell db={db} household={household} current={`person:${spender.id}`}>
      <p className="person-crumb">{labelsFor(household.kind).kind[spender.kind] ?? spender.kind}</p>
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
      {spender.kind === "agent" ? (
        <Hint q="What's an AI agent, and how does it connect?">
          <p>
            An AI agent is an assistant that does tasks for you, like Claude shopping on your behalf. Agents can already open shop pages and pay. Spotter
            makes sure they pay through a checkpoint you control.
          </p>
          <p>
            It connects with MCP, the standard way AI apps plug into tools. Your agent gets four Spotter tools: find real products and prices, ask to pay, check on a
            payment, and see what&apos;s left of its allowance. It has no tool to approve, so only you can say yes to a held payment.
          </p>
        </Hint>
      ) : (
        <Hint q={`How does ${spender.name} use Spotter?`}>
          <p>
            Nothing new to install. When something asks {spender.name} for money (a text, an email, a seller), they forward it to Spotter by email or Telegram. Spotter
            checks it against the rules you set here and replies to them in plain words.
          </p>
          <p>Small, ordinary payments go straight through. Anything over the ask you amount, to someone new, or that looks like a scam waits for you.</p>
        </Hint>
      )}
      <Connect
        spender={{ id: spender.id, name: spender.name, kind: spender.kind, email: spender.email, telegram: spender.telegram_chat_id, discord: spender.discord_user_id, currency: spender.allowance.weekly.currency, hasKey: spender.kind === "agent" && (await hasAgentToken(db, spender.id)) }}
        inbox={process.env.AGENTBOXD_INBOX_ADDRESS ?? null}
        telegramBot={process.env.TELEGRAM_BOT_USERNAME ?? null}
        discordApp={process.env.DISCORD_BOT_TOKEN ? (process.env.DISCORD_APPLICATION_ID ?? null) : null}
      />
      <h2 className="section-title">Recent payments</h2>
      {recent.length === 0 ? (
        <p className="lede">
          Nothing yet. Their payments show up here as soon as they ask to pay. <a href="/demo">Try one with fake money</a>.
        </p>
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
    </AppShell>
  );
}
