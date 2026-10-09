"use client";
import { useCallback, useEffect, useState } from "react";
import { Hand, ShieldCheck, Ban, Info } from "lucide-react";
import { Evidence, HoldTrack } from "@/ui/components";
import { money, STATE_LABEL, timeAgo, trackState } from "@/ui/format";
import type { Payment } from "@/core/lifecycle";

const SPENDER_NAMES: Record<string, string> = { agent: "Shopping agent", gran: "Gran", leo: "Leo" };
const who = (p: Payment) => SPENDER_NAMES[p.spender_id] ?? p.spender_id;

export function Dashboard({ initial }: { initial: Payment[] }) {
  const [payments, setPayments] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/payments", { cache: "no-store" });
      if (!r.ok) throw new Error(`Couldn't load payments (${r.status}).`);
      setPayments((await r.json()).payments);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load payments.");
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const waiting = payments.filter((p) => p.status === "needs_approval");
  const rest = payments.filter((p) => p.status !== "needs_approval");

  return (
    <div className="dash">
      <section aria-labelledby="waiting">
        <h1 id="waiting" className="page-title">
          {waiting.length ? `${waiting.length} waiting for you` : "Nothing waiting for you"}
        </h1>
        <p className="lede" style={{ marginTop: 6 }}>
          Payments that need a yes from you. The money is held by PayPal until you decide.
        </p>
        <div className="stack" style={{ marginTop: 20 }}>
          {waiting.length === 0 && (
            <div className="empty">
              <strong>All clear.</strong>
              When someone in your house, or your AI agent, tries a payment that needs a second look, it shows up here.
            </div>
          )}
          {waiting.map((p) => (
            <HeldCard key={p.id} p={p} onSettled={refresh} />
          ))}
        </div>
        {error && (
          <p className="error-line" role="alert" style={{ marginTop: 12 }}>
            {error} Retrying every few seconds.
          </p>
        )}
      </section>

      <section aria-labelledby="feed">
        <h2 id="feed" className="section-title" style={{ marginTop: 6 }}>
          Everything today
        </h2>
        {rest.length === 0 ? (
          <p className="feed-meta">No payments yet. Run a scenario from Try it.</p>
        ) : (
          <ul className="feed">
            {rest.map((p) => (
              <FeedRow key={p.id} p={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HeldCard({ p, onSettled }: { p: Payment; onSettled: () => void }) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [state, setState] = useState(trackState(p.status));
  const [error, setError] = useState<string | null>(null);
  const flags = p.ai?.flags ?? [];

  async function act(action: "approve" | "deny") {
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/payments/${p.id}/${action}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok && r.status !== 409) throw new Error(j.error ?? `PayPal step failed (${r.status}).`);
      setState(trackState(j.payment.status));
      setTimeout(onSettled, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      setBusy(null);
    }
  }

  return (
    <article className="held" aria-labelledby={`h-${p.id}`}>
      <div className="held-head">
        <div>
          <p id={`h-${p.id}`} className="held-amount num">
            {money(p.amount, p.currency)}
          </p>
          <p className="held-who">
            {who(p)} to {p.request.payee.name}, {timeAgo(p.created_at)}
          </p>
        </div>
      </div>

      <HoldTrack state={state} from={who(p)} to={p.request.payee.name} amount={p.amount} currency={p.currency} />

      {p.ai?.summary && <p className="held-summary">{p.ai.summary}</p>}

      {p.decision && p.decision.reasons.length > 0 && (
        <ul className="reasons">
          {p.decision.reasons.map((r, i) => (
            <li key={i} className="reason">
              <Info className="reason-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {p.request.context && <Evidence text={p.request.context} flags={flags} />}

      <div className="held-actions">
        <button className="btn btn-approve" disabled={busy !== null} onClick={() => act("approve")}>
          {busy === "approve" ? "Paying" : `Approve ${money(p.amount, p.currency)}`}
        </button>
        <button className="btn btn-deny" disabled={busy !== null} onClick={() => act("deny")}>
          {busy === "deny" ? "Releasing" : "Deny"}
        </button>
      </div>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

const ROW_ICON = { blocked: Ban, protected: ShieldCheck, held: Hand } as const;

function FeedRow({ p }: { p: Payment }) {
  const s = trackState(p.status);
  const Icon = ROW_ICON[s as keyof typeof ROW_ICON];
  const firstReason = p.decision?.reasons[0];
  return (
    <li className="feed-row">
      <span className="feed-title">
        {who(p)} to {p.request.payee.name}
      </span>
      <span className="feed-amount num">{money(p.amount, p.currency)}</span>
      <span className="feed-meta">
        {firstReason && s !== "paid" ? firstReason : `For ${p.request.category}.`}
        <span className="feed-time">{timeAgo(p.created_at)}</span>
      </span>
      <span className="feed-state" data-state={s}>
        {Icon && <Icon size={14} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />}
        {STATE_LABEL[s]}
      </span>
    </li>
  );
}
