"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, ShieldCheck, Ban, Info, Repeat, Moon, Clock, FileText } from "lucide-react";
import { DEFAULT_TZ, holdEndLine, whenText } from "@/core/holdtime";
import { Evidence, HoldTrack, MarketNote } from "@/ui/components";
import { money, replacementLink, STATE_LABEL, timeAgo, trackState } from "@/ui/format";
import type { Payment } from "@/core/lifecycle";
import { plainError, readJson } from "@/ui/http";
import { contradictsPrice, priceVerdict } from "@/core/market";
import { Hint } from "@/ui/Hint";
import { CaseFile, CasePending } from "@/ui/CaseFile";
import { PriceWatch, watchable } from "@/ui/PriceWatch";
import type { WatchView } from "@/core/watch";
import { WasItYouLine, wiyStatus } from "@/ui/WasItYou";


export function Dashboard({
  initial,
  names,
  unlocked,
  demo = false,
  tz = DEFAULT_TZ,
}: {
  initial: Payment[];
  names: Record<string, string>;
  unlocked: boolean;
  demo?: boolean;
  /** The household's time zone, for "asks again tomorrow at 9am" and when a hold ends. */
  tz?: string;
}) {
  const [payments, setPayments] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(!unlocked);
  const [watches, setWatches] = useState<WatchView[]>([]);

  const refresh = useCallback(async () => {
    try {
      // Price watches are extra: if they don't load, payments still show and the next poll tries again.
      const watchesCall = fetch("/api/watches", { cache: "no-store" })
        .then(async (w) => {
          const jw = await readJson(w);
          if (w.ok && Array.isArray(jw.watches)) setWatches(jw.watches);
          else console.warn("[spotter] price watches didn't load:", jw.error ?? w.status);
        })
        .catch((e: unknown) => console.warn("[spotter] price watches didn't load:", e));
      const r = await fetch("/api/payments", { cache: "no-store" });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Couldn't load payments (${r.status}).`);
      setPayments(j.payments);
      await watchesCall;
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load payments.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);
  const watchFor = (id: string) => watches.find((w) => w.paymentId === id);
  // Watches without a payment on this page: the demo family's example, or one an AI agent started.
  const loose = watches.filter((w) => !w.paymentId || !payments.some((p) => p.id === w.paymentId));

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

  // "Was it you?" answers arrive by polling too: say them out loud once (never on first load).
  const answers = useRef(new Map(initial.map((p) => [p.id, p.was_it_you?.state])));
  useEffect(() => {
    for (const p of payments) {
      const w = p.was_it_you;
      const before = answers.current.get(p.id);
      answers.current.set(p.id, w?.state);
      if (!w || before === w.state || (w.state !== "not_me" && w.state !== "it_was_me")) continue;
      const s = wiyStatus(w, p.status);
      setHeard(`${s.state}. ${s.detail}`);
    }
  }, [payments]);

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
              all={payments}
              who={names[p.spender_id] ?? "Someone"}
              demo={demo}
              tz={tz}
              watch={watchFor(p.id)}
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

      {loose.length > 0 && (
        <section aria-labelledby="watches">
          <h2 id="watches" className="section-title" style={{ marginTop: 6 }}>
            Price watches
          </h2>
          <p className="feed-meta">Spotter watches real shops and tells you when a price comes down. It never buys anything.</p>
          <ul className="watch-list">
            {loose.map((w) => (
              <li key={w.id}>
                <p className="watch-for">
                  {w.who ?? "Someone"} nearly paid {money(w.nearlyPaid, w.currency)} for {w.item}
                  {w.createdBy === "agent" ? " (the agent asked Spotter to watch it)" : ""}
                </p>
                <PriceWatch watch={w} onChanged={refresh} />
              </li>
            ))}
          </ul>
        </section>
      )}

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
              <FeedRow key={p.id} p={p} all={payments} who={names[p.spender_id] ?? "Someone"} watch={watchFor(p.id)} onWatchChanged={refresh} />
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

/** The other half of a replacement (an agent taking Spotter's safer option, or the spotter's swap), as a jump link. */
function ReplacedLink({ p, all, who }: { p: Payment; all: Payment[]; who: string }) {
  const link = replacementLink(p, all, who);
  if (!link) return null;
  const there = all.some((x) => x.id === link.id);
  return (
    <p className="replaced-link">
      <Repeat size={15} strokeWidth={2} aria-hidden="true" />
      <span>
        {link.text}
        {there && (
          <>
            {" "}
            <a href={`#pay-${link.id}`}>See it</a>
          </>
        )}
      </span>
    </p>
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
  all,
  who,
  demo,
  tz,
  watch,
  onSettled,
  onLocked,
  onDecided,
}: {
  p: Payment;
  all: Payment[];
  who: string;
  demo: boolean;
  tz: string;
  watch?: WatchView;
  onSettled: () => void;
  onLocked: () => void;
  onDecided: (text: string) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | "swap" | "sleep" | null>(null);
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

  /** "Ask again tomorrow": the hold stays, nothing is paid or released, so no PIN. */
  async function sleepOnIt() {
    if (busy) return;
    setBusy("sleep");
    setError(null);
    try {
      const r = await fetch(`/api/payments/${p.id}/sleep`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = await readJson(r);
      if (!r.ok || !j.payment) throw new Error(j.error ?? `That didn't go through (${r.status}).`);
      onDecided(`${money(p.amount, p.currency)} to ${p.request.payee.name}: ${j.message ?? "Spotter asks again tomorrow."}`);
      onSettled();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(null);
    }
  }

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
      setError(plainError(e));
      setBusy(null);
      // A wrong PIN: put the cursor back in the PIN box so it can be typed again.
      if (action === "approve") pinRef.current?.focus();
    }
  }

  return (
    <article className="held" id={`pay-${p.id}`} aria-labelledby={`h-${p.id}`}>
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

      <ReplacedLink p={p} all={all} who={who} />

      <WasItYouLine w={p.was_it_you} status={p.status} />

      {p.case_file ? (
        <CaseFile
          c={p.case_file}
          currency={p.currency}
          paymentId={p.id}
          peekScrolls={p.peek_scrolls}
          busy={busy === "swap"}
          onSwap={busy ? undefined : () => act("swap")}
          footer={watchable(p) || watch ? <PriceWatch watch={watch} paymentId={p.id} onChanged={onSettled} /> : null}
        />
      ) : (
        <>
          <CasePending createdAt={p.created_at} />
          {(watchable(p) || watch) && <PriceWatch watch={watch} paymentId={p.id} onChanged={onSettled} />}
        </>
      )}

      <HoldClock p={p} who={who} tz={tz} />
      <EvidenceLinks p={p} />

      {/* The message check never saw the market listings, so its summary is hidden when it argues with them. */}
      {p.ai?.summary && !contradictsPrice(p.ai.summary, priceVerdict(p.market)) && (
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
          {!p.ask_again_at && (
            <button type="button" className="btn btn-quiet btn-sleep" aria-disabled={busy !== null || undefined} onClick={sleepOnIt}>
              {busy === "sleep" ? "Saving" : "Ask again tomorrow"}
            </button>
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

const EVIDENCE_FOR = new Set(["needs_approval", "voiding", "voided", "blocked", "protected"]);

/** One click to a printable evidence page for the bank, PayPal or the police, and a plain text copy. */
function EvidenceLinks({ p }: { p: Payment }) {
  if (!EVIDENCE_FOR.has(p.status)) return null;
  const href = `/api/payments/${encodeURIComponent(p.id)}/evidence`;
  return (
    <p className="evidence-links">
      <FileText size={16} strokeWidth={2} aria-hidden="true" />
      <a href={href} target="_blank" rel="noopener">
        Evidence pack<span className="sr-only"> (opens a printable page in a new tab)</span>
      </a>
      <span aria-hidden="true">·</span>
      <a href={`${href}?format=txt`} download>
        Plain text<span className="sr-only"> copy of the evidence pack</span>
      </a>
      <span className="evidence-for">for your bank, PayPal or the police</span>
    </p>
  );
}

/** When Spotter asks again (if someone chose to sleep on it) and, always, when PayPal lets the hold go on its own. */
function HoldClock({ p, who, tz }: { p: Payment; who: string; tz: string }) {
  const until = p.ask_again_at ? new Date(p.ask_again_at) : null;
  return (
    <div className="hold-clock">
      {until && (
        <p className="hold-clock-sleep">
          <Moon size={17} strokeWidth={2} aria-hidden="true" />
          <span>
            <b>Sleeping on it.</b> Spotter asks again {whenText(until, tz)}. The money stays held.
          </span>
        </p>
      )}
      {p.reauthorized_at && <p className="hold-clock-note">PayPal renewed the hold after 3 days, so the money is still set aside.</p>}
      {p.reauth_note && <p className="hold-clock-note">{p.reauth_note}</p>}
      <p className="hold-clock-end">
        <Clock size={17} strokeWidth={2} aria-hidden="true" />
        <span>{holdEndLine(p, who, tz)}</span>
      </p>
    </div>
  );
}

const ROW_ICON ={ blocked: Ban, protected: ShieldCheck, held: Hand } as const;

function FeedRow({ p, all, who, watch, onWatchChanged }: { p: Payment; all: Payment[]; who: string; watch?: WatchView; onWatchChanged: () => void }) {
  const s = trackState(p.status);
  const Icon = ROW_ICON[s as keyof typeof ROW_ICON];
  const firstReason = p.decision?.reasons[0];
  return (
    <li className="feed-row" id={`pay-${p.id}`}>
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
      <ReplacedLink p={p} all={all} who={who} />
      <EvidenceLinks p={p} />
      <WasItYouLine w={p.was_it_you} status={p.status} />
      {p.case_file && (
        // Stopped payments have a case file too; one with a high severity finding (hidden orders, two faces) starts open.
        <details className="feed-case" open={p.case_file.findings.some((f) => f.severity === "high")}>
          <summary>What Spotter found</summary>
          <CaseFile c={p.case_file} currency={p.currency} paymentId={p.id} peekScrolls={p.peek_scrolls} />
        </details>
      )}
      {(watchable(p) || watch) && (
        <div className="feed-watch">
          <PriceWatch watch={watch} paymentId={p.id} onChanged={onWatchChanged} />
        </div>
      )}
    </li>
  );
}
