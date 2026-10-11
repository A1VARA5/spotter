"use client";
// What the family's AI agents asked PayPal's toolkit for that needs the spotter: a paused agent (it reached for a tool
// its job doesn't use), a refund a selling agent asked for, a subscription waiting for approval. Plus example sales for
// a selling agent. Everything an agent or a page wrote is shown as plain text, never as markup.
import { useId, useState } from "react";
import type { AgentHolds as Holds } from "@/server/agent-holds";
import type { Job } from "@/core/toolkit-coverage";
import { formatMoney, type Currency } from "@/core/types";
import { timeAgo } from "./format";
import "./toolkit.css";

const money = (amount: number, currency: string) => formatMoney({ amount, currency: currency as Currency });

const CAUSE: Record<string, string> = {
  hidden_text: "Text hidden from people on the page it read",
  poisoned_tool: "A line in a tool the page offered AI agents",
  flagged_line: "A line Spotter's check flagged as orders for AI agents",
};

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, any> }> {
  try {
    const r = await fetch("/api/toolkit/holds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as Record<string, any>;
    return { ok: r.ok, data };
  } catch {
    return { ok: false, data: { error: "Spotter couldn't be reached. Check your connection and try again." } };
  }
}

async function reload(): Promise<Holds | null> {
  try {
    const r = await fetch("/api/toolkit/holds");
    return r.ok ? ((await r.json()) as Holds) : null;
  } catch {
    return null;
  }
}

/** A PIN box and one button. The PIN is asked every time money moves or an agent is unpaused. */
function PinAction({ label, tone, onSubmit }: { label: string; tone: "approve" | "primary"; onSubmit: (pin: string) => Promise<string | null> }) {
  const id = useId();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="ah-pin"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const problem = await onSubmit(pin);
        setBusy(false);
        if (problem) setError(problem);
        else setPin("");
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Spotter PIN
      </label>
      <input id={id} className="pin-input num ah-pin-input" inputMode="numeric" autoComplete="off" spellCheck={false} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
      <button className={`btn ${tone === "approve" ? "btn-approve" : "btn-primary"}`} aria-disabled={busy || !pin} disabled={!pin}>
        {busy ? "Checking" : label}
      </button>
      {error && (
        <p className="error-line ah-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function AgentHolds({ initial }: { initial: Holds }) {
  const [h, setH] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const paused = h.agents.filter((a) => a.frozen_at);
  const trips = paused.map((a) => ({ agent: a, trip: h.tripwires.find((t) => t.spender_id === a.id && !t.unfrozen_at) ?? null }));
  const refunds = h.refunds.filter((r) => r.status !== "denied").slice(0, 6);
  const subs = h.subscriptions.filter((s) => s.status === "held" || links[s.id]);
  const sellers = h.agents.filter((a) => a.agent_job === "selling");
  if (!trips.length && !refunds.length && !subs.length && !sellers.length) return null;

  async function act(body: Record<string, unknown>): Promise<string | null> {
    const r = await post(body);
    if (!r.ok) return String(r.data.error ?? r.data.message ?? "That didn't go through.");
    if (typeof r.data.message === "string") setNotice(r.data.message);
    if (typeof r.data.approveUrl === "string" && typeof body.id === "string") setLinks((l) => ({ ...l, [body.id as string]: r.data.approveUrl }));
    const fresh = await reload();
    if (fresh) setH(fresh);
    else setNotice(`${typeof r.data.message === "string" ? `${r.data.message} ` : ""}Spotter couldn't refresh this list, so reload the page to see it as it is now.`);
    return null;
  }

  async function deny(kind: "refund" | "subscription", id: string) {
    setBusy(id);
    const problem = await act({ kind, id, action: "deny" });
    setBusy(null);
    if (problem) setNotice(problem);
  }

  return (
    <section className="ah" aria-labelledby="ah-title">
      <h2 id="ah-title" className="ah-title">
        Your agents and PayPal&apos;s tools
      </h2>
      {notice && (
        <p className="ah-notice" role="status">
          {notice}
        </p>
      )}

      {trips.map(({ agent, trip }) => (
        <article key={agent.id} className="ah-card ah-paused" aria-labelledby={`ah-p-${agent.id}`}>
          <h3 id={`ah-p-${agent.id}`} className="ah-card-title">
            {agent.name} is paused
          </h3>
          {trip ? (
            <>
              <p className="ah-line">
                It reached for PayPal&apos;s <code>{trip.tool}</code> tool, which has nothing to do with its job. Spotter never ran it and nothing was sent to PayPal.
                {trip.voided ? ` ${trip.voided === 1 ? "Its held payment was" : `Its ${trip.voided} held payments were`} let go.` : ""}{" "}
                <span className="ah-when" suppressHydrationWarning>{timeAgo(trip.at)}</span>
              </p>
              <div className="ah-block">
                <p className="ah-block-title">What it asked for</p>
                <p className="ah-block-sub">Whoever steered it may have written this. Shown as plain text.</p>
                <pre className="ah-args">{trip.args.text}</pre>
                {trip.args.cut && <p className="ah-block-sub">Cut short here.</p>}
              </div>
              <div className="ah-block">
                <p className="ah-block-title">What could have caused it</p>
                {trip.cause ? (
                  <>
                    <p className="ah-block-sub">
                      {CAUSE[trip.cause.kind] ?? "A line it read"}
                      {trip.cause.toolName ? ` (${trip.cause.toolName})` : ""}, while paying {trip.cause.payee}:
                    </p>
                    <blockquote className="ah-quote">{trip.cause.quote}</blockquote>
                  </>
                ) : (
                  <p className="ah-block-sub">Spotter didn&apos;t see a page with hidden orders for this agent in the last day. Ask whoever set it up what it was doing.</p>
                )}
              </div>
            </>
          ) : (
            <p className="ah-line">It reached for a tool its job doesn&apos;t use.</p>
          )}
          <p className="ah-line">When you&apos;re happy it&apos;s safe, unpause it with your PIN.</p>
          <PinAction label={`Unpause ${agent.name}`} tone="primary" onSubmit={(pin) => act({ kind: "agent", id: agent.id, action: "unfreeze", pin })} />
        </article>
      ))}

      {refunds.map((r) => (
        <article key={r.id} className={`ah-card ah-refund ah-${r.status}`} aria-labelledby={`ah-r-${r.id}`}>
          <h3 id={`ah-r-${r.id}`} className="ah-card-title">
            {r.status === "refused"
              ? "Refund refused"
              : r.status === "held"
                ? "Refund waiting for you"
                : r.status === "failed"
                  ? "Refund not sent"
                  : r.status === "refunding"
                    ? "Refund not confirmed yet"
                    : "Refund sent"}
            : {money(r.amount, r.currency)}
          </h3>
          <p className="ah-line">
            {r.agent ?? "An agent"} asked to refund {money(r.amount, r.currency)} for &quot;{r.item}&quot;. The buyer paid {money(r.paid, r.currency)}.
            {r.example ? " Example sale in PayPal's sandbox." : ""} <span className="ah-when" suppressHydrationWarning>{timeAgo(r.created_at)}</span>
          </p>
          {r.reason && <p className="ah-alarm">{r.reason}</p>}
          {r.note && (
            <p className="ah-block-sub">
              Note to the buyer, as the agent wrote it: <q>{r.note}</q>
            </p>
          )}
          {r.status === "held" && (
            <>
              <p className="ah-line">If you approve, PayPal sends it back to the original payment only. Nobody new can be paid this way.</p>
              <div className="ah-actions">
                <PinAction label={`Approve ${money(r.amount, r.currency)} refund`} tone="approve" onSubmit={(pin) => act({ kind: "refund", id: r.id, action: "approve", pin })} />
                <button type="button" className="btn btn-deny" aria-disabled={busy === r.id} onClick={() => busy !== r.id && void deny("refund", r.id)}>
                  Turn it down
                </button>
              </div>
            </>
          )}
          {r.status === "refunded" && <p className="ah-line">{r.confirmed_at ? "PayPal confirmed the refund." : "Sent. Waiting for PayPal to confirm it."}</p>}
          {r.status === "failed" && r.error && <p className="ah-alarm">{r.error}</p>}
          {r.status === "refunding" && (
            <p className="ah-alarm">Spotter asked PayPal for this refund but didn&apos;t hear back. Check PayPal before doing anything else, so it isn&apos;t sent twice.</p>
          )}
        </article>
      ))}

      {subs.map((s) => (
        <article key={s.id} className="ah-card ah-sub" aria-labelledby={`ah-s-${s.id}`}>
          <h3 id={`ah-s-${s.id}`} className="ah-card-title">{links[s.id] ? "Approve it at PayPal" : "Subscription waiting for you"}: {s.plan_name}</h3>
          <p className="ah-tail">{s.tail_text}</p>
          {s.cut_up && (
            <p className="ah-alarm">
              The same money cut up? {money(s.cut_up.held, s.cut_up.currency)} to {s.cut_up.payee} was held or stopped earlier today, and now {s.agent ?? "the agent"} wants a subscription to {s.payee}.
            </p>
          )}
          <p className="ah-line">
            {s.agent ?? "An agent"} started it. PayPal keeps it waiting until someone approves it, and only you get the approval link. <span className="ah-when" suppressHydrationWarning>{timeAgo(s.created_at)}</span>
          </p>
          {links[s.id] ? (
            <p className="ah-line">
              <a className="btn btn-approve" href={links[s.id]} target="_blank" rel="noopener noreferrer">
                Approve it at PayPal
              </a>
            </p>
          ) : (
            <div className="ah-actions">
              <PinAction label="Get the approval link" tone="approve" onSubmit={(pin) => act({ kind: "subscription", id: s.id, action: "approve", pin })} />
              <button type="button" className="btn btn-deny" aria-disabled={busy === s.id} onClick={() => busy !== s.id && void deny("subscription", s.id)}>
                Turn it down
              </button>
            </div>
          )}
        </article>
      ))}

      {sellers.map((a) => (
        <article key={a.id} className="ah-card ah-seller" aria-labelledby={`ah-sell-${a.id}`}>
          <h3 id={`ah-sell-${a.id}`} className="ah-card-title">{a.name} sells for the family</h3>
          <p className="ah-line">
            Its refunds wait for you, only go back to the original payment and can&apos;t be more than the buyer paid. It can&apos;t add tracking until PayPal shows the money arrived.
          </p>
          <ul className="ah-sales">
            {h.sales
              .filter((s) => s.agent === a.name)
              .map((s) => (
                <li key={s.id}>
                  {s.item}: {money(s.amount, s.currency)} {s.capture_id ? "paid" : "not paid yet"}
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="btn btn-quiet"
            aria-disabled={busy === a.id}
            onClick={async () => {
              if (busy === a.id) return;
              setBusy(a.id);
              const problem = await act({ kind: "sale", id: a.id, action: "example" });
              setBusy(null);
              setNotice(problem ?? "Example sale made in PayPal's sandbox: £50.00 paid for trainers.");
            }}
          >
            {busy === a.id ? "Making it" : "Make an example sale (£50, sandbox)"}
          </button>
        </article>
      ))}
    </section>
  );
}

/** The agent's job for PayPal's tools, for the agent's connect panel. Shopping is the default. */
export function AgentJob({ agentId, job: initial }: { agentId: string; job: Job }) {
  const [job, setJob] = useState<Job>(initial);
  const [error, setError] = useState<string | null>(null);
  async function pick(j: Job) {
    if (j === job) return;
    setError(null);
    const r = await post({ kind: "agent", id: agentId, action: "job", job: j });
    if (r.ok) setJob(j);
    else setError(String(r.data.error ?? "That didn't go through."));
  }
  return (
    <div className="ah-job">
      <div className="tkc-switch" role="radiogroup" aria-label="This agent's job">
        {(["shopping", "selling"] as Job[]).map((j) => (
          <button key={j} type="button" role="radio" aria-checked={job === j} className="tkc-switch-btn" onClick={() => void pick(j)}>
            {j === "shopping" ? "It shops" : "It sells"}
          </button>
        ))}
      </div>
      <p className="ah-block-sub">
        {job === "selling"
          ? "It gets paid: refunds wait for your PIN and tracking needs proof of payment. PayPal accounts are for over 18s, so the account holder is the spotter."
          : "It pays: seller tools like refunds and invoices are tripwires. Calling one pauses it."}
      </p>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
