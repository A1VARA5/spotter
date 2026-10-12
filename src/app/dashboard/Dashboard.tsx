"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Hand, ShieldCheck, Ban, Info, Repeat, Moon, Clock, FileText, Camera, TrendingDown, ChevronRight, ChevronDown, X, ExternalLink, ScanEye } from "lucide-react";
import { DEFAULT_TZ, holdEndLine, whenText } from "@/core/holdtime";
import { Evidence, HoldTrack, MarketNote } from "@/ui/components";
import { money, replacementLink, STATE_LABEL, timeAgo, trackState } from "@/ui/format";
import type { Payment } from "@/core/lifecycle";
import type { Case } from "@/agents/case";
import { plainError, readJson } from "@/ui/http";
import { contradictsPrice, priceVerdict } from "@/core/market";
import { Hint } from "@/ui/Hint";
import { CaseFile, CasePending } from "@/ui/CaseFile";
import { PriceWatch, watchable } from "@/ui/PriceWatch";
import { SharedWatch } from "@/ui/SharedWatch";
import type { WatchUpdates, WatchView } from "@/core/watch";
import { WasItYouLine, wiyStatus } from "@/ui/WasItYou";
import { PhotoCheck } from "@/ui/PhotoCheck";
import { PayPalRetry } from "@/ui/PayPalRetry";
import { Peek } from "@/ui/Peek";
import { peekableHost } from "@/ui/peekable";
import { weekSummary } from "@/ui/week";
import { approveWarning } from "@/ui/labels";
import { AI_DOWN_LINE, AI_UNFINISHED_LINE, BACKUP_LINE } from "@/core/aiwords";
import { kernelLead, realOne, unsaidReasons, type RealOne } from "@/ui/caseFold";
import { decidedReason, topReason } from "@/core/reasons";
import { outcomeLine, settledCase, shownOutcome } from "@/core/settled";
import { tripOutcome } from "@/core/tripped";
import { TripFound } from "@/ui/TripFound";
import "./allclear.css";
import "./wide.css";
import { BUSINESS_SCENARIOS, SCENARIOS, type Scenario } from "@/ui/scenarios";


type DashCtx = {
  payments: Payment[];
  names: Record<string, string>;
  demo: boolean;
  business: boolean;
  tz: string;
  now: number;
  watches: WatchView[];
  /** How live watches hear about prices (daily checks, or Channel3's webhook as well). */
  watchUpdates?: WatchUpdates;
  error: string | null;
  locked: boolean;
  setLocked: (v: boolean) => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<DashCtx | null>(null);
function useDash() {
  const c = useContext(Ctx);
  if (!c) throw new Error("Dashboard parts must sit inside <DashboardState>.");
  return c;
}

/**
 * "Now" for anything that says how long ago something happened. The first render uses the server's clock, so the
 * HTML and the first client render agree (a browser clock a minute or two off turned "5 min ago" into "7 min ago"
 * and broke hydration, React error 418). After that it follows the browser's clock.
 */
function useNow(serverNow: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The new number of payments waiting for the spotter, or null when it is still `shown`. The sidebar's count is
 * rendered by the server (AppShell), so a change means the shell needs a refresh. */
export function waitingChanged(shown: number, payments: Pick<Payment, "status">[]): number | null {
  const n = payments.filter((p) => p.status === "needs_approval").length;
  return n === shown ? null : n;
}

/**
 * The dashboard's live state (payments and price watches, polled every 3 seconds), shared by the two parts the app
 * shell lays out: the waiting queue in the primary column, and Everything today plus the tools in the rail.
 */
export function DashboardState({
  initial,
  names,
  unlocked,
  demo = false,
  tz = DEFAULT_TZ,
  serverNow,
  business = false,
  children,
}: {
  initial: Payment[];
  names: Record<string, string>;
  unlocked: boolean;
  demo?: boolean;
  /** A small business household: the empty state suggests the business Try scenarios. */
  business?: boolean;
  /** The household's time zone, for "asks again tomorrow at 9am" and when a hold ends. */
  tz?: string;
  /** The server's clock when it rendered the page, so relative times match on the first render. */
  serverNow: number;
  children: React.ReactNode;
}) {
  const [payments, setPayments] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(!unlocked);
  const [watches, setWatches] = useState<WatchView[]>([]);
  const [watchUpdates, setWatchUpdates] = useState<WatchUpdates | undefined>(undefined);
  const now = useNow(serverNow);
  const router = useRouter();
  // What the sidebar's "Waiting for you" count showed when the server last rendered it.
  const shownWaiting = useRef(initial.filter((p) => p.status === "needs_approval").length);

  const refresh = useCallback(async () => {
    try {
      // Price watches are extra: if they don't load, payments still show and the next poll tries again.
      const watchesCall = fetch("/api/watches", { cache: "no-store" })
        .then(async (w) => {
          const jw = await readJson(w);
          if (w.ok && Array.isArray(jw.watches)) {
            setWatches(jw.watches);
            if (jw.updates === "on_change" || jw.updates === "daily") setWatchUpdates(jw.updates);
          }
          else console.warn("[spotter] price watches didn't load:", jw.error ?? w.status);
        })
        .catch((e: unknown) => console.warn("[spotter] price watches didn't load:", e));
      const r = await fetch("/api/payments", { cache: "no-store" });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Couldn't load payments (${r.status}).`);
      setPayments(j.payments);
      // A deny, approve or new hold changed the queue: re-render the server shell so the sidebar count follows.
      const waiting = waitingChanged(shownWaiting.current, j.payments);
      if (waiting !== null) {
        shownWaiting.current = waiting;
        router.refresh();
      }
      await watchesCall;
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load payments.");
    }
  }, [router]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ payments, names, demo, business, tz, now, watches, watchUpdates, error, locked, setLocked, refresh }}>{children}</Ctx.Provider>;
}

/** The hold that opens first: one Spotter thinks is a scam, else the oldest. */
/** What Everything today says when it has no other rows: held payments count, so it never says "no payments" beside a hold. */
export function feedEmpty(held: number): string {
  if (held === 0) return "No payments yet.";
  return held === 1 ? "Nothing else yet. The one payment so far is waiting for you." : `Nothing else yet. All ${held} payments so far are waiting for you.`;
}

export function firstToOpen(waiting: Payment[]): string | null {
  const risky = waiting.find((p) => p.case_file?.verdict === "likely_scam" || (p.ai?.flags ?? []).some((f) => f.severity === "high"));
  return (risky ?? waiting[waiting.length - 1])?.id ?? null;
}

/** Primary column: what is waiting for a decision, one card open at a time. */
export function DashboardMain() {
  const { payments, names, demo, tz, now, watches, watchUpdates, error, locked, setLocked, refresh } = useDash();
  const waiting = payments.filter((p) => p.status === "needs_approval");
  const watchFor = (id: string) => watches.find((w) => w.paymentId === id);

  // undefined: nobody has picked yet, so the first card opens. null: the spotter closed them all.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const openId = picked === undefined || (picked !== null && !waiting.some((p) => p.id === picked)) ? firstToOpen(waiting) : picked;

  // A link to a held card (#pay-...) opens that card.
  useEffect(() => {
    const onHash = () => {
      if (location.hash.startsWith("#pay-")) setPicked(decodeURIComponent(location.hash.slice(5)));
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // What a decision just did, shown where the card was and focused, so keyboard and screen reader users
  // land on the result instead of the page body when the card goes.
  const [notice, setNotice] = useState<{ text: string; real?: RealOne & { currency: string }; n: number } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  // New holds arrive by polling: say so politely, only for ones not seen before (never on first load).
  const [heard, setHeard] = useState("");
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = payments.filter((p) => p.status === "needs_approval").map((p) => p.id);
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const fresh = payments.filter((p) => p.status === "needs_approval" && !known.has(p.id));
    const first = fresh[0];
    if (!first) return;
    fresh.forEach((p) => known.add(p.id));
    setHeard(
      `New: ${money(first.amount, first.currency)} from ${names[first.spender_id] ?? "someone"} to ${first.request.payee.name} is waiting for you.` +
        (ids.length > 1 ? ` ${ids.length} waiting in all.` : ""),
    );
  }, [payments, names]);

  // "Was it you?" answers arrive by polling too: say them out loud once (never on first load).
  const answers = useRef<Map<string, string | undefined> | null>(null);
  useEffect(() => {
    if (!answers.current) {
      answers.current = new Map(payments.map((p) => [p.id, p.was_it_you?.state]));
      return;
    }
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
    <section className="dash" aria-labelledby="waiting">
      <div>
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
      </div>
      {locked && <PinGate onUnlocked={() => setLocked(false)} />}
      <p className="sr-only" role="status">
        {heard}
      </p>
      {notice && (
        <p ref={noticeRef} tabIndex={-1} className="dash-notice" key={notice.n}>
          {notice.text}
          {notice.real && (
            <>
              {" "}
              {notice.real.exact ? "Here's the real one" : "Here's a real listing"} at {notice.real.domain} for {money(notice.real.price, notice.real.currency)}:{" "}
              <a href={notice.real.url} target="_blank" rel="noopener noreferrer nofollow" className="dash-notice-real">
                {notice.real.title}
                <ExternalLink size={14} strokeWidth={2.2} aria-hidden="true" />
                <span className="sr-only"> (opens {notice.real.domain}&apos;s own page in a new tab)</span>
              </a>
            </>
          )}
        </p>
      )}
      <div className="stack" data-beside={waiting.length === 1 || undefined}>
        {waiting.length === 0 && <AllClear />}
        {waiting.map((p) => (
          <HeldCard
            key={p.id}
            p={p}
            all={payments}
            who={names[p.spender_id] ?? "Someone"}
            demo={demo}
            tz={tz}
            now={now}
            open={openId === p.id}
            onToggle={() => setPicked(openId === p.id ? null : p.id)}
            watch={watchFor(p.id)}
            watchUpdates={watchUpdates}
            onSettled={refresh}
            onLocked={() => setLocked(true)}
            onDecided={(text, real) => setNotice((n) => ({ text, real, n: (n?.n ?? 0) + 1 }))}
          />
        ))}
        {/* One card on a very wide screen (2200 px and up): the week and the Try scenarios sit beside it (wide.css). */}
        {waiting.length === 1 && (
          <aside className="allclear dash-beside" aria-label="While you decide">
            <AllClearCols />
          </aside>
        )}
      </div>
      {error && (
        <p className="error-line" role="alert">
          {error} Retrying every few seconds.
        </p>
      )}
    </section>
  );
}

const TRY_FAMILY = ["gran-hi-mum", "agent-trap", "leo-giftcard"];
const TRY_BUSINESS = ["biz-invoice", "biz-paper"];

/**
 * Nothing waiting: say so, then fill the column with something useful instead of white space. What Spotter did in
 * the last 7 days (from the same payments the rail lists, by the shared clock), and a few Try scenarios to watch it
 * catch something.
 */
function AllClear() {
  return (
    <div className="allclear">
      <div className="allclear-head">
        <ShieldCheck size={22} strokeWidth={2} aria-hidden="true" />
        <p>
          <strong>All clear.</strong> Nothing needs you right now. Anything risky is held at PayPal and lands here first.
        </p>
      </div>
      <AllClearCols />
    </div>
  );
}

/** Your last 7 days and Watch it catch something: under All clear, or beside a lone card on a very wide screen. */
function AllClearCols() {
  const { payments, business, now } = useDash();
  const w = weekSummary(payments, now);
  const tries = (business ? TRY_BUSINESS : TRY_FAMILY).map((id) => [...SCENARIOS, ...BUSINESS_SCENARIOS].find((s) => s.id === id)).filter((s): s is Scenario => !!s);
  const kept = w.kept.map((k) => money(k.amount, k.currency)).join(" and ");
  const parts = [
    { key: "paid", n: w.paid, label: "paid" },
    { key: "stopped", n: w.stopped, label: "stopped or denied" },
    { key: "other", n: w.checked - w.paid - w.stopped - w.waiting, label: "checking or failed" },
  ].filter((x) => x.n > 0);

  return (
    <div className="allclear-cols">
      <section className="allclear-week" aria-labelledby="allclear-week">
        <h2 id="allclear-week" className="allclear-title">
          Your last 7 days
        </h2>
        {w.checked === 0 ? (
          <>
            <p className="allclear-text">No payments went through Spotter this week yet. Try one with fake money and it shows up here.</p>
            <ul className="allclear-checks" aria-label="What Spotter checks on every payment">
              <li>Your rules first: the allowance, blocked shops and who needs asking.</li>
              <li>The message behind it, read by AI that has to quote its evidence.</li>
              <li>Links opened in a throwaway cloud browser, so nobody clicks them.</li>
              <li>Real shop prices, so a fake bargain or an overcharge shows.</li>
            </ul>
          </>
        ) : (
          <>
            <p className="allclear-text">
              Spotter checked {w.checked} payment{w.checked === 1 ? "" : "s"}.{" "}
              {w.stopped > 0 ? (
                <>
                  {w.stopped} {w.stopped === 1 ? "was" : "were"} stopped or denied before any money moved, keeping <b>{kept}</b> with you.
                </>
              ) : (
                "None needed stopping."
              )}
            </p>
            <div className="allclear-bar" aria-hidden="true">
              {parts.map((x) => (
                <span key={x.key} data-part={x.key} style={{ flexGrow: x.n }} />
              ))}
            </div>
            <ul className="allclear-legend">
              {parts.map((x) => (
                <li key={x.key} data-part={x.key}>
                  <b>{x.n}</b> {x.label}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="allclear-links">
          <Link href="/ledger">Every payment in Activity</Link>
          <Link href="/watchtower">Ask Watchtower about your month</Link>
        </p>
      </section>
      <section className="allclear-try" aria-labelledby="allclear-try">
        <h2 id="allclear-try" className="allclear-title">
          Watch it catch something
        </h2>
        <ul className="allclear-tries">
          {tries.map((s) => (
            <li key={s.id}>
              <Link href={`/demo#s-${s.id}`} className="allclear-tryrow">
                <span className="allclear-trytitle">{s.title}</span>
                <span className="allclear-trywho">{s.blurb}</span>
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="allclear-note">Fake money in the PayPal sandbox. Each one lands here to decide.</p>
      </section>
    </div>
  );
}

/** The rail: Everything today (newest first, each opens its case file), then the tools as compact buttons. */
export function DashboardRail() {
  const { payments, names, now, watches, watchUpdates, refresh, demo } = useDash();
  const rest = payments.filter((p) => p.status !== "needs_approval");
  const watchFor = (id: string) => watches.find((w) => w.paymentId === id);
  // Every price watch, live ones first: one started on a held card shows here straight away, next to the example.
  const listed = [...watches].sort((a, b) => Number(a.example) - Number(b.example));
  // Demo families also see the shared live watch (Channel3 tracking one real product for all of them), before the example.
  const own = listed.filter((w) => !w.example);
  const examples = listed.filter((w) => w.example);
  const live = own.filter((w) => w.status === "watching").length + (demo ? 1 : 0);
  const count = listed.length + (demo ? 1 : 0);
  // The latest page KERNEL opened that can be looked at again safely (a link from the payment's own message).
  const peekable = payments.find((p) => peekableHost(p));

  return (
    <div className="dash-rail">
      <section aria-labelledby="feed">
        <h2 id="feed" className="section-title">
          Everything today
        </h2>
        {rest.length === 0 ? (
          <p className="feed-meta">
            {feedEmpty(payments.length - rest.length)} <Link href="/demo">Try one with fake money</Link>.
          </p>
        ) : (
          <ul className="feed">
            {rest.map((p) => (
              <FeedRow key={p.id} p={p} all={payments} who={names[p.spender_id] ?? "Someone"} now={now} watch={watchFor(p.id)} watchUpdates={watchUpdates} onWatchChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="tools" className="dash-tools">
        <h2 id="tools" className="section-title">
          Tools
        </h2>
        <Sheet label="Check a photo or a screenshot" wide triggerClass="tool-btn" trigger={<ToolLabel icon={Camera} title="Check a photo or a screenshot" sub="A scam text, a doorstep quote or an ad. Nothing is paid." />}>
          <PhotoCheck />
        </Sheet>
        {peekable && (
          <div className="tool-peek">
            <p className="tool-peek-title">
              <ScanEye size={18} strokeWidth={1.9} aria-hidden="true" className="tool-icon" /> Look at a link safely
            </p>
            <p className="tool-sub">
              Opens {peekableHost(peekable)}, from {names[peekable.spender_id] ?? "someone"}&apos;s {money(peekable.amount, peekable.currency)} payment, in a throwaway cloud browser (KERNEL). You see
              the page; nothing is typed or clicked. Three looks a day.
            </p>
            <Peek paymentId={peekable.id} host={peekableHost(peekable)!} />
          </div>
        )}
        {count > 0 && (
          <Sheet
            title="Price watches"
            triggerClass="tool-btn"
            trigger={
              <ToolLabel
                icon={TrendingDown}
                title={`Price watches (${count})`}
                sub={live > 0 ? `${live} live, checked with Channel3. Spotter tells you when a price comes down.` : "Spotter tells you when a price comes down."}
              />
            }
          >
            <p className="feed-meta">Spotter checks real shop prices with Channel3 and tells you when one comes down. It never buys anything.</p>
            <ul className="watch-list">
              {own.map((w) => (
                <li key={w.id}>
                  <PriceWatch watch={w} onChanged={refresh} updates={watchUpdates} variant="panel" />
                </li>
              ))}
              {demo && (
                <li>
                  <SharedWatch />
                </li>
              )}
              {examples.map((w) => (
                <li key={w.id}>
                  <PriceWatch watch={w} onChanged={refresh} updates={watchUpdates} variant="panel" />
                </li>
              ))}
            </ul>
          </Sheet>
        )}
      </section>
    </div>
  );
}

function ToolLabel({ icon: Icon, title, sub }: { icon: typeof Camera; title: string; sub: string }) {
  return (
    <>
      <Icon size={18} strokeWidth={1.9} aria-hidden="true" className="tool-icon" />
      <span className="tool-text">
        <span className="tool-title">{title}</span>
        <span className="tool-sub">{sub}</span>
      </span>
      <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="tool-go" />
    </>
  );
}

/**
 * A panel that opens over the page: centred on wide screens, a sheet from the bottom on phones. Built on the
 * native <dialog>, which keeps focus inside, closes on Escape and gives focus back to the button. What's inside
 * is only rendered once it has been opened, then kept, so a half filled form survives closing it.
 */
function Sheet({
  trigger,
  triggerClass,
  title,
  label,
  wide = false,
  children,
}: {
  trigger: React.ReactNode;
  triggerClass: string;
  /** The panel's heading. Leave it out when the content has its own heading, and give a label instead. */
  title?: string;
  label?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [shown, setShown] = useState(false);
  return (
    <>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="dialog"
        onClick={() => {
          setShown(true);
          ref.current?.showModal();
        }}
      >
        {trigger}
      </button>
      <dialog
        ref={ref}
        className="sheet"
        data-wide={wide || undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        // The content fills the dialog, so a click that lands on the dialog itself is on the dimmed backdrop.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="sheet-box">
          <div className="sheet-head">
            {title && (
              <h2 id={titleId} className="sheet-title">
                {title}
              </h2>
            )}
            <button type="button" className="sheet-close" aria-label="Close" onClick={() => ref.current?.close()}>
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {shown && children}
        </div>
      </dialog>
    </>
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
  if (after.status === "needs_approval" && after.error) return after.error;
  if (after.status === "voiding" && after.error) return `Denied. PayPal didn't confirm releasing the ${amount} yet, so Spotter is retrying. Spotter won't pay ${payee}.`;
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
  now,
  open,
  onToggle,
  watch,
  watchUpdates,
  onSettled,
  onLocked,
  onDecided,
}: {
  p: Payment;
  all: Payment[];
  who: string;
  demo: boolean;
  tz: string;
  /** Shared clock (the server's on the first render, so the HTML matches). */
  now: number;
  /** Open shows the whole case file; closed shows one summary line. The decision buttons show either way. */
  open: boolean;
  onToggle: () => void;
  watch?: WatchView;
  watchUpdates?: WatchUpdates;
  onSettled: () => void;
  onLocked: () => void;
  onDecided: (text: string, real?: RealOne & { currency: string }) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | "swap" | "sleep" | null>(null);
  const [state, setState] = useState(trackState(p.status));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState("");
  // While the case is being built, tick faster than the shared clock so Approve unlocks on time.
  const [tick, setTick] = useState<number | null>(null);
  const flags = p.ai?.flags ?? [];
  const pending = !p.case_file && (tick ?? now) - new Date(p.created_at).getTime() < CASE_WAIT_MS;
  // When Spotter thinks it's a scam, saying no is the main action and saying yes takes a deliberate step.
  const scamLike = p.case_file?.verdict === "likely_scam" || flags.some((f) => f.severity === "high");
  // Without a finished check, Deny comes first too (Approve keeps its normal look unless it looks like a scam).
  const denyFirst = scamLike || !checkComplete(p);
  const warning = approveWarning(p.case_file?.verdict, flags.some((f) => f.severity === "high"));
  const bodyId = `body-${p.id}`;
  // A genuine listing from Channel3 (the case's own offer, else the market check's cheapest real shop).
  const real = realOne(p.case_file, p.market);

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setTick(Date.now()), 3000);
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
      const released = j.payment.status === "voided"; // a void PayPal didn't confirm yet (voiding) isn't released money
      if (action !== "swap") onDecided(decidedLine(j.payment, p), action === "deny" && released && real ? { ...real, currency: p.currency } : undefined);
      setTimeout(onSettled, 700);
    } catch (e) {
      setError(plainError(e));
      setBusy(null);
      // A wrong PIN: put the cursor back in the PIN box so it can be typed again.
      if (action === "approve") pinRef.current?.focus();
    }
  }

  const decide = confirming ? (
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
      {warning && <p className="held-confirm-warn">{warning}</p>}
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `pin-err-${p.id}` : undefined}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
      />
      {/* A wrong PIN is said right under the PIN box, where the cursor goes back to. */}
      {error && (
        <p id={`pin-err-${p.id}`} className="error-line held-pin-error" role="alert">
          {error}
        </p>
      )}
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
      ) : denyFirst ? (
        <>
          <button className="btn btn-deny" aria-disabled={busy !== null || undefined} onClick={() => act("deny")}>
            {busy === "deny" ? "Releasing" : "Deny"}
          </button>
          <button ref={approveRef} className="btn btn-approve" disabled={pending} aria-disabled={busy !== null || undefined} onClick={() => !busy && setConfirming(true)}>
            {pending ? "Checking first" : `Approve ${money(p.amount, p.currency)}`}
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
  );
  const decision = (
    <div className="held-decide">
      {decide}
      {pending && !confirming && <p className="held-wait">Approve opens once Spotter has finished looking into it (a few seconds). Deny works now.</p>}
      {error && !confirming && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  const c = p.case_file ? withoutHoldFinding(p.case_file) : null;
  const priceWatch = watchable(p) || watch ? <PriceWatch watch={watch} paymentId={p.id} onChanged={onSettled} updates={watchUpdates} /> : null;
  // Inside the case file the decision sits right after the three facts; without one (still looking), after the card.
  const decideInCase = open && !!c;
  // The rules engine's reasons, minus the ones the case file already says (price, first time payee, hidden orders).
  const reasons = unsaidReasons(p.decision?.reasons ?? [], p.decision?.flags ?? p.ai?.flags ?? [], c, { lead: kernelLead(c?.page)?.kind ?? null });
  const channel3OnCard = !!c && (c.findings.some((f) => f.tool === "find_genuine_offer") || !!c.spot);

  const extras = (
    <>
      <HoldClock p={p} who={who} tz={tz} />
      <EvidenceLinks p={p} />

      {/* The case file's verdict is the card's one summary, so the message check's own line only shows without one.
          It never saw the market listings either, so it is hidden when it argues with them. */}
      {!c && p.ai?.summary && !contradictsPrice(p.ai.summary, priceVerdict(p.market)) && (
        <p className="held-summary">
          <strong>Scam check:</strong> {p.ai.summary}
        </p>
      )}
      {!c && aiFailedLine(p) && <p className="held-summary">{aiFailedLine(p)}</p>}
      {p.ai?.ok && p.ai.aiEngine === "openai_backup" && <p className="held-summary">{BACKUP_LINE}</p>}

      {reasons.length > 0 && (
        <ul className="reasons" aria-label={c ? "Spotter's rules" : "Why it was held"}>
          {reasons.map((r, i) => (
            <li key={i} className="reason">
              <Info className="reason-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {!channel3OnCard && <MarketNote market={p.market} currency={p.currency} />}

      {p.request.context && <Evidence text={p.request.context} flags={flags} />}
    </>
  );

  return (
    <article className="held" id={`pay-${p.id}`} aria-labelledby={`h-${p.id}`} data-open={open || undefined}>
      <div className="held-head">
        <div>
          <p id={`h-${p.id}`} className="held-amount num">
            {money(p.amount, p.currency)}
          </p>
          <p className="held-who">
            {who} to {p.request.payee.name}, {timeAgo(p.created_at, now)}
          </p>
        </div>
        <button type="button" className="held-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          {open ? "Hide the case file" : "Open the case file"}
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {!open && <HeldSummary p={p} pending={pending} />}

      <WasItYouLine w={p.was_it_you} status={p.status} now={now} />

      <div className="held-body" id={bodyId} hidden={!open}>
        <HoldTrack state={state} from={who} to={p.request.payee.name} amount={p.amount} currency={p.currency} />

        <ReplacedLink p={p} all={all} who={who} />

        {c ? (
          <CaseFile
            c={c}
            currency={p.currency}
            paymentId={p.id}
            peekScrolls={p.peek_scrolls}
            now={now}
            busy={busy === "swap"}
            onSwap={busy ? undefined : () => act("swap")}
            fold
            real={real}
            aside={priceWatch}
            actions={decideInCase ? decision : undefined}
            more={extras}
            moreCount={(p.request.context ? 1 : 0) + (reasons.length ? 1 : 0)}
          />
        ) : (
          <>
            <CasePending createdAt={p.created_at} now={tick ?? now} />
            {priceWatch}
            {extras}
          </>
        )}
      </div>

      {!decideInCase && decision}
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
            <b>Sleeping on it.</b> Spotter asks again {whenText(until, tz)}. The money stays held until the date below. PayPal sets that limit, not Spotter.
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

/**
 * On a held card the hold clock under the case file already says when PayPal lets the hold go, so the case file's
 * PayPal hold finding (the same date again) is left out there.
 */
export function withoutHoldFinding(c: Case): Case {
  return c.findings.some((f) => f.tool === "paypal_hold") ? { ...c, findings: c.findings.filter((f) => f.tool !== "paypal_hold") } : c;
}

/**
 * True when the AI looked at this payment and its case file was written: the message check ran and the case agent
 * finished (fully or in part) with the model. Until then Deny leads on the card, so nobody approves on a guess.
 */
export function checkComplete(p: Pick<Payment, "ai" | "case_file">): boolean {
  const c = p.case_file;
  return p.ai?.ok === true && !!c && c.status !== "failed" && !c.aiDown;
}

/**
 * What the card says when the message check didn't finish: an outage (no AI could answer) said as one, anything
 * else (a refusal, an answer in the wrong shape) said as "couldn't finish". Null when the check ran.
 */
export function aiFailedLine(p: Pick<Payment, "ai">): string | null {
  if (!p.ai || p.ai.ok) return null;
  return p.ai.aiDown ? AI_DOWN_LINE : AI_UNFINISHED_LINE;
}

const VERDICT_LINE = { likely_scam: "Likely a scam", unclear: "Worth a closer look", looks_fine: "Looks genuine" } as const;

/** A closed held card in one line: Spotter's verdict and its headline, or that it is still looking. */
function HeldSummary({ p, pending }: { p: Payment; pending: boolean }) {
  const c = p.case_file;
  if (c) {
    return (
      <p className="held-sum" data-verdict={c.verdict}>
        <b>{VERDICT_LINE[c.verdict]}.</b> {c.headline}
      </p>
    );
  }
  const failed = aiFailedLine(p);
  if (failed) return <p className="held-sum">{failed}</p>;
  const reason = topReason(p);
  return <p className="held-sum">{pending ? "Spotter is still looking into it." : (reason ?? "Open the case file to see why it was held.")}</p>;
}

function FeedRow({
  p,
  all,
  who,
  now,
  watch,
  watchUpdates,
  onWatchChanged,
}: {
  p: Payment;
  all: Payment[];
  who: string;
  now: number;
  watch?: WatchView;
  watchUpdates?: WatchUpdates;
  onWatchChanged: () => void;
}) {
  // A hold a tripwire let go, or a Not me released, never reads as a person's deny (src/core/settled.ts shownOutcome).
  const trip = tripOutcome(p);
  const own = shownOutcome(p);
  const s = own ? own.state : trackState(p.status);
  const label = own ? own.long : STATE_LABEL[s];
  const Icon = ROW_ICON[s as keyof typeof ROW_ICON];
  // The strongest sign, in the past tense once it's decided; a paid payment only has one if Spotter held it.
  const firstReason = p.decision?.outcome === "allow" ? null : decidedReason(p);
  const canWatch = watchable(p) || !!watch;
  // A finding like hidden orders or two faces is the reason to look, so its button stands out.
  const serious = !!p.case_file?.findings.some((f) => f.severity === "high");
  return (
    <li className="feed-row" id={`pay-${p.id}`}>
      <span className="feed-title">
        {who} to {p.request.payee.name}
      </span>
      <span className="feed-amount num">{money(p.amount, p.currency)}</span>
      <span className="feed-meta">
        <span className="feed-why">{s === "failed" && p.error ? p.error : firstReason ? firstReason : `For ${p.request.category}.`}</span>
        <span className="feed-time">{timeAgo(p.created_at, now)}</span>
      </span>
      <span className="feed-state" data-state={s}>
        {Icon && <Icon size={14} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />}
        {label}
      </span>
      <WasItYouLine w={p.was_it_you} status={p.status} now={now} />
      <PayPalRetry p={p} onDone={onWatchChanged} />
      {(p.case_file || canWatch || trip) && (
        <div className="feed-open">
          <Sheet
            wide={!!p.case_file}
            title={`${who} to ${p.request.payee.name}, ${money(p.amount, p.currency)}`}
            triggerClass={serious || trip ? "feed-open-btn" : "feed-open-btn feed-open-quiet"}
            trigger={
              <>
                {p.case_file || trip ? "What Spotter found" : "Watch the price"}
                <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
              </>
            }
          >
            <p className="feed-state sheet-state" data-state={s}>
              {label}
            </p>
            {!trip && outcomeLine(p) && <p className="sheet-outcome">{outcomeLine(p)}</p>}
            <TripFound p={p} />
            <ReplacedLink p={p} all={all} who={who} />
            <EvidenceLinks p={p} />
            {p.case_file && (
              <CaseFile
                c={settledCase(p.case_file, p)}
                currency={p.currency}
                paymentId={p.id}
                peekScrolls={p.peek_scrolls}
                now={now}
                fold
                settled={p.status !== "needs_approval"}
                real={s === "paid" ? null : realOne(p.case_file, p.market)}
                aside={canWatch ? <PriceWatch watch={watch} paymentId={p.id} onChanged={onWatchChanged} updates={watchUpdates} /> : null}
              />
            )}
            {!p.case_file && canWatch && <PriceWatch watch={watch} paymentId={p.id} onChanged={onWatchChanged} updates={watchUpdates} />}
          </Sheet>
        </div>
      )}
    </li>
  );
}
