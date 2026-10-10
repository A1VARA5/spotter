"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, ShieldCheck, Ban, Info } from "lucide-react";
import { Evidence, HoldTrack, MarketNote } from "@/ui/components";
import { money, STATE_LABEL, timeAgo, trackState } from "@/ui/format";
import type { Payment } from "@/core/lifecycle";
import { readJson } from "@/ui/http";
import { Hint } from "@/ui/Hint";
import { CaseFile, CasePending } from "@/ui/CaseFile";


export function Dashboard({ initial, names, unlocked, demo = false }: { initial: Payment[]; names: Record<string, string>; unlocked: boolean; demo?: boolean }) {
  const [payments, setPayments] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(!unlocked);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/payments", { cache: "no-store" });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Couldn't load payments (${r.status}).`);
      setPayments(j.payments);
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

  // What a decision just did, shown where the card was and focused, so keyboard and screen reader users
  // land on the result instead of the page body when the card goes.
  const [notice, setNotice] = useState<{ text: string; n: number } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  // New holds arrive by polling: say so politely, only for ones not seen before (never on first load).
  const [heard, setHeard] = useState("");
  const seen = useRef(new Set(initial.filter((p) => p.status === "needs_approval").map((p) => p.id)));
  useEffect(() => {
    const fresh = payments.filter((p) => p.status === "needs_approval" && !seen.current.has(p.id));
    const first = fresh[0];
    if (!first) return;
    fresh.forEach((p) => seen.current.add(p.id));
    const all = payments.filter((p) => p.status === "needs_approval").length;
    setHeard(
      `New: ${money(first.amount, first.currency)} from ${names[first.spender_id] ?? "someone"} to ${first.request.payee.name} is waiting for you.` +
        (all > 1 ? ` ${all} waiting in all.` : ""),
    );
  }, [payments, names]);

  return (
    <div className="dash">
      <section aria-labelledby="waiting">
        <h1 id="waiting" className="page-title">
          {waiting.length ? `${waiting.length} waiting for you` : "Nothing waiting for you"}
        </h1>
        <p className="lede" style={{ marginTop: 6 }}>
          Payments that need a yes from you. The money is held by PayPal until you decide.
        </p>
        <Hint q="How does a hold work?">
          <p>
            Spotter asks PayPal to authorise the payment instead of taking it. The money is reserved on the payer&apos;s side, but nothing reaches the payee. Approve and
            PayPal captures it. Deny and PayPal releases it. Unanswered holds expire on their own.
          </p>
        </Hint>
        {locked && <PinGate onUnlocked={() => setLocked(false)} />}
        <p className="sr-only" role="status">
          {heard}
        </p>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="dash-notice" key={notice.n}>
            {notice.text}
          </p>
        )}
        <div className="stack" style={{ marginTop: 20 }}>
          {waiting.length === 0 && (
            <div className="empty">
              <strong>All clear.</strong>
              When someone in your house, or your AI agent, tries a payment that needs a second look, it shows up here.
              <Link className="btn btn-quiet empty-cta" href="/demo">
                Try a payment
              </Link>
            </div>
          )}
          {waiting.map((p) => (
            <HeldCard
              key={p.id}
              p={p}
              who={names[p.spender_id] ?? "Someone"}
              demo={demo}
              onSettled={refresh}
              onLocked={() => setLocked(true)}
              onDecided={(text) => setNotice((n) => ({ text, n: (n?.n ?? 0) + 1 }))}
            />
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
          <p className="feed-meta">
            No payments yet. <Link href="/demo">Try one with fake money</Link>.
          </p>
        ) : (
          <ul className="feed">
            {rest.map((p) => (
              <FeedRow key={p.id} p={p} who={names[p.spender_id] ?? "Someone"} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    const j = await readJson(r);
    setBusy(false);
    if (r.ok) onUnlocked();
    else setError(j.error ?? "That PIN isn't right.");
  }

  return (
    <form className="pin" onSubmit={unlock} aria-labelledby="pin-title">
      <p id="pin-title" className="pin-title">
        Enter your PIN to approve or deny.
      </p>
      <div className="pin-row">
        <label className="sr-only" htmlFor="pin">
          Spotter PIN
        </label>
        <input
          id="pin"
          className="pin-input num"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
        />
        <button className="btn btn-primary" disabled={busy || !pin}>
          {busy ? "Checking" : "Unlock"}
        </button>
      </div>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** The case agent has up to 45 seconds; until its case file lands (or that time passes) nobody approves blind. */
const CASE_WAIT_MS = 50_000;

/** One sentence for what a decision did, read out and shown where the card was. */
function decidedLine(after: Payment, before: Payment) {
  const amount = money(before.amount, before.currency);
  const payee = before.request.payee.name;
  const s = trackState(after.status);
  if (s === "paid") return `Paid. ${amount} went to ${payee}.`;
  if (s === "moving") return `Approved. PayPal is paying ${amount} to ${payee}.`;
  if (s === "returned") return `Denied. PayPal released the ${amount}, nothing went to ${payee}.`;
  if (s === "failed") return `PayPal said no to ${amount} for ${payee}. Nothing was paid.`;
  return `${amount} to ${payee}: ${STATE_LABEL[s]}.`;
}

function HeldCard({
  p,
  who,
  demo,
  onSettled,
  onLocked,
  onDecided,
}: {
  p: Payment;
  who: string;
  demo: boolean;
  onSettled: () => void;
  onLocked: () => void;
  onDecided: (text: string) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | "swap" | null>(null);
  const [state, setState] = useState(trackState(p.status));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const flags = p.ai?.flags ?? [];
  const pending = !p.case_file && now - new Date(p.created_at).getTime() < CASE_WAIT_MS;
  // When Spotter thinks it's a scam, saying no is the main action and saying yes takes a deliberate step.
  const scamLike = p.case_file?.verdict === "likely_scam" || flags.some((f) => f.severity === "high");

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, [pending]);

  const approveRef = useRef<HTMLButtonElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const wasConfirming = useRef(false);
  // Cancelling the PIN step puts focus back on the button that opened it.
  useEffect(() => {
    if (wasConfirming.current && !confirming) approveRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function act(action: "approve" | "deny" | "swap") {
    // Busy buttons stay focusable (aria-disabled) so focus isn't lost; repeat presses stop here instead.
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/payments/${p.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "approve" ? { pin } : {}),
      });
      const j = await readJson(r);
      if (r.status === 401) {
        onLocked();
        setBusy(null);
        return;
      }
      // Wrong PIN, still being checked, or someone already decided it in another tab: say so, don't pretend.
      if (!r.ok || !j.payment) throw new Error(j.error ?? `That didn't go through (${r.status}).`);
      setState(trackState(j.payment.status));
      if (action !== "swap") onDecided(decidedLine(j.payment, p));
      setTimeout(onSettled, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      setBusy(null);
      // A wrong PIN: put the cursor back in the PIN box so it can be typed again.
      if (action === "approve") pinRef.current?.focus();
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
            {who} to {p.request.payee.name}, {timeAgo(p.created_at)}
          </p>
        </div>
      </div>

      <HoldTrack state={state} from={who} to={p.request.payee.name} amount={p.amount} currency={p.currency} />

      {p.case_file ? (
        <CaseFile c={p.case_file} currency={p.currency} paymentId={p.id} busy={busy === "swap"} onSwap={busy ? undefined : () => act("swap")} />
      ) : (
        <CasePending createdAt={p.created_at} />
      )}

      {p.ai?.summary && (
        <p className="held-summary">
          <strong>Scam check:</strong> {p.ai.summary}
        </p>
      )}

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

      <MarketNote market={p.market} currency={p.currency} />

      {p.request.context && <Evidence text={p.request.context} flags={flags} />}

      {confirming ? (
        <form
          className="held-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin) act("approve");
          }}
        >
          <p className="held-confirm-title">
            Pay {money(p.amount, p.currency)} to {p.request.payee.name}?
          </p>
          {scamLike && <p className="held-confirm-warn">Spotter thinks this is likely a scam. Once PayPal pays, it can&apos;t be pulled back.</p>}
          <label className="field-label" htmlFor={`pin-${p.id}`}>
            Your PIN{demo ? " (the demo family's PIN is 2468)" : ""}
          </label>
          <input
            ref={pinRef}
            id={`pin-${p.id}`}
            className="pin-input num"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <div className="held-actions">
            <button type="submit" className={scamLike ? "btn btn-deny" : "btn btn-approve"} disabled={!pin} aria-disabled={busy !== null || undefined}>
              {busy === "approve" ? "Paying" : `Pay ${money(p.amount, p.currency)}`}
            </button>
            <button type="button" className="btn btn-quiet" aria-disabled={busy !== null || undefined} onClick={() => !busy && setConfirming(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="held-actions" data-scam={scamLike || undefined}>
          {scamLike ? (
            <>
              <button className="btn btn-stop" aria-disabled={busy !== null || undefined} onClick={() => act("deny")}>
                {busy === "deny" ? "Releasing" : "Deny"}
              </button>
              <button ref={approveRef} className="btn btn-quiet" disabled={pending} aria-disabled={busy !== null || undefined} onClick={() => !busy && setConfirming(true)}>
                {pending ? "Checking first" : `Approve ${money(p.amount, p.currency)} anyway`}
              </button>
            </>
          ) : (
            <>
              <button ref={approveRef} className="btn btn-approve" disabled={pending} aria-disabled={busy !== null || undefined} onClick={() => !busy && setConfirming(true)}>
                {pending ? "Checking first" : `Approve ${money(p.amount, p.currency)}`}
              </button>
              <button className="btn btn-deny" aria-disabled={busy !== null || undefined} onClick={() => act("deny")}>
                {busy === "deny" ? "Releasing" : "Deny"}
              </button>
            </>
          )}
        </div>
      )}
      {pending && !confirming && <p className="held-wait">Approve opens once Spotter has finished looking into it (a few seconds). Deny works now.</p>}
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

const ROW_ICON = { blocked: Ban, protected: ShieldCheck, held: Hand } as const;

function FeedRow({ p, who }: { p: Payment; who: string }) {
  const s = trackState(p.status);
  const Icon = ROW_ICON[s as keyof typeof ROW_ICON];
  const firstReason = p.decision?.reasons[0];
  return (
    <li className="feed-row">
      <span className="feed-title">
        {who} to {p.request.payee.name}
      </span>
      <span className="feed-amount num">{money(p.amount, p.currency)}</span>
      <span className="feed-meta">
        {s === "failed" && p.error ? p.error : firstReason && s !== "paid" ? firstReason : `For ${p.request.category}.`}
        <span className="feed-time">{timeAgo(p.created_at)}</span>
      </span>
      <span className="feed-state" data-state={s}>
        {Icon && <Icon size={14} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />}
        {STATE_LABEL[s]}
      </span>
      {p.case_file && (
        // Stopped payments have a case file too; one that caught hidden orders for an AI agent starts open.
        <details className="feed-case" open={p.case_file.findings.some((f) => f.kind === "prompt_injection")}>
          <summary>What Spotter found</summary>
          <CaseFile c={p.case_file} currency={p.currency} paymentId={p.id} />
        </details>
      )}
    </li>
  );
}
