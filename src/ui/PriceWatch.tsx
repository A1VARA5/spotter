"use client";
// Price watch on a payment: after a payment was too dear, held or denied, the spotter can ask Spotter to watch the
// price at real shops (Channel3) for 14 days. A drop is shown here and sent to the spotter's alert channels. Nothing
// is ever bought: the line only says where and for how much, with a link to the shop's own page.
// Two looks: "inline" sits on a payment card; "panel" is one watch in the dashboard's Price watches dialog, laid out
// like a price tracker (item, best now against nearly paid, a labelled chart, the source, one status badge).
import { useEffect, useRef, useState } from "react";
import { Eye, TrendingDown } from "lucide-react";
import type { WatchUpdates, WatchView } from "@/core/watch";
import { priceWatchFits } from "@/core/market";
import { money } from "./format";
import { plainError, readJson } from "./http";
import { leadCap } from "@/core/userText";
import "./pricewatch.css";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const safeLink = (u: string) => (/^https:\/\//.test(u) ? u : "");
/** Whole pounds drop the pence, for axis labels: £89, not £89.00. */
const short = (pence: number, currency: WatchView["currency"]) => money(pence, currency).replace(/\.00$/, "");

/** One badge for what kind of watch this is, the same on cards and in the dialog. */
function StatusBadge({ w }: { w: WatchView }) {
  if (w.example) return <span className="pw-badge" data-tone="example">Example, checked earlier</span>;
  if (w.status === "watching" || w.status === "dropped")
    return (
      <span className="pw-badge" data-tone="live">
        Live
      </span>
    );
  return (
    <span className="pw-badge" data-tone="ended">
      Ended
    </span>
  );
}

/** A tiny line of the price over time, for cards. Decorative: the words next to it say the same thing. */
function Spark({ w }: { w: WatchView }) {
  const pts = w.history?.points ?? [];
  if (pts.length < 2) return <p className="watch-spark-empty">The price line fills in as Spotter checks each day.</p>;
  const prices = pts.map((p) => p.price);
  const lo = Math.min(...prices, w.target);
  const hi = Math.max(...prices, w.target);
  const span = hi - lo || 1;
  const W = 120;
  const H = 32;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const first = pts[0]!;
  const last = pts.at(-1)!;
  return (
    <p className="watch-spark">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
        <line x1="0" x2={W} y1={y(w.target)} y2={y(w.target)} className="watch-spark-target" />
        <polyline points={pts.map((p, i) => `${x(i)},${y(p.price)}`).join(" ")} className="watch-spark-line" />
        <circle cx={x(pts.length - 1)} cy={y(last.price)} r="2.5" className="watch-spark-dot" />
      </svg>
      <span>
        {money(first.price, w.currency)} on {day(first.at)}, {money(last.price, w.currency)} on {day(last.at)}
        {w.history?.source === "channel3" ? " (price history from Channel3)" : ""}
      </span>
    </p>
  );
}

/**
 * The price over time for the dialog: a real small chart with its highest and lowest price on the left axis, first
 * and last day under it, and the target as a labelled dashed line. Each point has a native tooltip; the label says
 * the same thing in one sentence for screen readers.
 */
function PriceChart({ w }: { w: WatchView }) {
  return <HistoryChart points={w.history?.points ?? []} currency={w.currency} target={w.target} state={w.status} />;
}

/** The chart itself, also used by the shared live watch (SharedWatch.tsx), which has no target. */
export function HistoryChart({ points: pts, currency, target, state, empty = "The price line fills in as Spotter checks each day." }: {
  points: Array<{ at: string; price: number }>;
  currency: WatchView["currency"];
  target?: number;
  state?: string;
  empty?: string;
}) {
  if (pts.length < 2) return <p className="pw-chart-empty">{empty}</p>;
  const prices = pts.map((p) => p.price);
  const lo = Math.min(...prices, ...(target === undefined ? [] : [target]));
  const hi = Math.max(...prices, ...(target === undefined ? [] : [target]));
  const span = hi - lo || 1;
  const W = 360;
  const H = 128;
  const L = 44; // room for the price labels
  const R = target === undefined ? 12 : 72; // room for the target label
  const T = 10;
  const B = 24; // room for the dates
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const first = pts[0]!;
  const last = pts.at(-1)!;
  const label = `Price went from ${money(first.price, currency)} on ${day(first.at)} to ${money(last.price, currency)} on ${day(last.at)}.${target === undefined ? "" : ` Target ${money(target, currency)}.`}`;
  return (
    <figure className="pw-chart" data-state={state}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        <line className="pw-grid" x1={L} x2={W - R} y1={y(hi)} y2={y(hi)} />
        <line className="pw-grid" x1={L} x2={W - R} y1={y(lo)} y2={y(lo)} />
        <text className="pw-axis" x={L - 8} y={y(hi)} dy="0.35em" textAnchor="end">
          {short(hi, currency)}
        </text>
        <text className="pw-axis" x={L - 8} y={y(lo)} dy="0.35em" textAnchor="end">
          {short(lo, currency)}
        </text>
        {target !== undefined && (
          <>
            <line className="pw-target" x1={L} x2={W - R} y1={y(target)} y2={y(target)} />
            <text className="pw-target-label" x={W - R + 6} y={y(target)} dy="0.35em">
              Target {short(target, currency)}
            </text>
          </>
        )}
        <polyline className="pw-line" points={pts.map((p, i) => `${x(i)},${y(p.price)}`).join(" ")} />
        {pts.map((p, i) => (
          <g key={p.at + i}>
            <circle className="pw-hit" cx={x(i)} cy={y(p.price)} r="10">
              <title>{`${money(p.price, currency)} on ${day(p.at)}`}</title>
            </circle>
            {i === pts.length - 1 && <circle className="pw-dot" cx={x(i)} cy={y(p.price)} r="4" />}
          </g>
        ))}
        <text className="pw-axis" x={L} y={H - 6}>
          {day(first.at)}
        </text>
        <text className="pw-axis" x={W - R} y={H - 6} textAnchor="end">
          {day(last.at)}
        </text>
      </svg>
    </figure>
  );
}

/** How often a live watch is really checked: daily by the cron job, plus Channel3's price change webhook when it is set up. */
function HowChecked({ updates }: { updates?: WatchUpdates }) {
  if (!updates) return null;
  return (
    <p className="watch-how">
      {updates === "on_change"
        ? "Channel3 price tracking tells Spotter when it sees the price change, usually within minutes, and Spotter checks it every day as well."
        : "Spotter checks the price every day with Channel3 price tracking. It only says it dropped when a real shop's listing shows it."}
    </p>
  );
}

type LineProps = {
  w: WatchView;
  onStop?: () => void;
  busy: boolean;
  lineRef: React.RefObject<HTMLParagraphElement | null>;
  updates?: WatchUpdates;
};

function StopButton({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  return (
    <button type="button" className="btn btn-quiet watch-stop" aria-disabled={busy || undefined} onClick={() => !busy && onStop()}>
      {busy ? "Stopping" : "Stop watching"}
    </button>
  );
}

/** On a payment card: one short block. */
function WatchLine({ w, onStop, busy, lineRef, updates }: LineProps) {
  const who = w.who ?? "they";
  if (w.status === "dropped" && w.best) {
    const link = safeLink(w.best.url);
    return (
      <div className="watch" data-state="dropped">
        <p className="watch-head">
          <TrendingDown size={16} strokeWidth={2.2} aria-hidden="true" /> Price dropped <StatusBadge w={w} />
        </p>
        <p ref={lineRef} tabIndex={-1} className="watch-line">
          {w.best.shop} now sells the {w.item} {who} wanted for <b>{money(w.best.price, w.currency)}</b>
          {w.saving ? <>, {money(w.saving, w.currency)} less than {who} nearly paid.</> : "."}{" "}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer nofollow">
              See it at the shop
            </a>
          )}
        </p>
        <p className="watch-note">Nothing is bought unless you decide to.</p>
        <Spark w={w} />
      </div>
    );
  }
  if (w.status === "watching") {
    return (
      <div className="watch" data-state="watching">
        <p className="watch-head">
          <Eye size={16} strokeWidth={2.2} aria-hidden="true" /> Watching the price until {day(w.expiresAt)} <StatusBadge w={w} />
        </p>
        <p ref={lineRef} tabIndex={-1} className="watch-line">
          Target <b className="num">{money(w.target, w.currency)}</b> or less at a real shop: Spotter tells you when one sells it for that.
          {w.best ? ` Best real price now: ${money(w.best.price, w.currency)} at ${w.best.shop}.` : ""}
        </p>
        {!w.example && <HowChecked updates={updates} />}
        <Spark w={w} />
        {onStop && <StopButton busy={busy} onStop={onStop} />}
      </div>
    );
  }
  return (
    <p ref={lineRef} tabIndex={-1} className="watch-ended">
      {w.status === "stopped" ? "You stopped watching this price." : `Price watch ended on ${day(w.expiresAt)} without a drop.`}
    </p>
  );
}

/** In the Price watches dialog: one watch, laid out like a price tracker. */
function WatchPanel({ w, onStop, busy, lineRef, updates }: LineProps) {
  const who = w.who ?? "Someone";
  const link = w.best ? safeLink(w.best.url) : "";
  const dropped = w.status === "dropped" && w.best;
  return (
    <article className="pw" data-state={w.status}>
      <header className="pw-head">
        <h3 className="pw-item">{leadCap(w.item)}</h3>
        <StatusBadge w={w} />
      </header>
      <dl className="pw-compare">
        <div className="pw-now">
          <dt>Best price now</dt>
          <dd className="pw-price num">{w.best ? money(w.best.price, w.currency) : "Not found yet"}</dd>
          {w.best && <dd className="pw-where">at {w.best.shop}</dd>}
        </div>
        <div className="pw-was">
          <dt>{who} nearly paid</dt>
          <dd className="pw-price num">{money(w.nearlyPaid, w.currency)}</dd>
          <dd className="pw-where">{w.createdBy === "agent" ? "The agent asked Spotter to watch it" : `on ${day(w.createdAt)}`}</dd>
        </div>
      </dl>
      <p ref={lineRef} tabIndex={-1} className="pw-result">
        {dropped ? (
          <>
            <TrendingDown size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>
              {w.saving ? (
                <>
                  Price dropped: <b>{money(w.saving, w.currency)} less</b> than {who} nearly paid.
                </>
              ) : (
                <>Price dropped to the target.</>
              )}
            </span>
          </>
        ) : w.status === "watching" ? (
          <>
            <Eye size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>
              Watching until {day(w.expiresAt)} for <b>{money(w.target, w.currency)}</b> or less at a real shop.
            </span>
          </>
        ) : (
          <span>{w.status === "stopped" ? "You stopped watching this price." : `Ended on ${day(w.expiresAt)} without a drop.`}</span>
        )}
      </p>
      <PriceChart w={w} />
      <p className="pw-source">
        {w.example
          ? "Example prices, checked earlier with Channel3."
          : w.history?.source === "channel3"
            ? "Prices and history from Channel3."
            : "Prices from Channel3."}
      </p>
      {!w.example && w.status === "watching" && <HowChecked updates={updates} />}
      {(link || (onStop && w.status === "watching")) && (
        <div className="pw-actions">
          {link && (
            <a className="btn btn-quiet" href={link} target="_blank" rel="noopener noreferrer nofollow">
              See it at the shop
            </a>
          )}
          {onStop && w.status === "watching" && <StopButton busy={busy} onStop={onStop} />}
        </div>
      )}
    </article>
  );
}

/**
 * The watch for one payment, or the button that starts one. Spotter only, no PIN: watching moves no money.
 * Focus moves to the result line after either button, like the rest of the dashboard.
 */
export function PriceWatch({
  watch,
  paymentId,
  onChanged,
  updates,
  variant = "inline",
}: {
  watch?: WatchView;
  paymentId?: string;
  onChanged?: () => void;
  updates?: WatchUpdates;
  variant?: "inline" | "panel";
}) {
  const [mine, setMine] = useState<WatchView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [focusNext, setFocusNext] = useState(false);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  // What this card just did shows straight away; the poll's copy wins once it has caught up (the newer watch, or the
  // same watch once it is no longer behind on a stop).
  const w = !mine
    ? watch
    : !watch
      ? mine
      : watch.id !== mine.id
        ? new Date(watch.createdAt) > new Date(mine.createdAt)
          ? watch
          : mine
        : mine.status === "watching" || watch.status !== "watching"
          ? watch
          : mine;

  useEffect(() => {
    if (!focusNext) return;
    (lineRef.current ?? errRef.current)?.focus();
    setFocusNext(false);
  }, [focusNext, w, error]);

  async function call(url: string, body?: unknown, done?: (v: WatchView) => string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const j = await readJson(r);
      if (!r.ok || !j.watch) throw new Error(j.error ?? `That didn't go through (${r.status}).`);
      setMine(j.watch);
      setSaid(done ? done(j.watch) : "");
      onChanged?.();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
      setFocusNext(true);
    }
  }

  const start = () =>
    call("/api/watches", { paymentId }, (v) =>
      v.status === "dropped" ? "A real shop already has it for less." : `Watching the price live. Target ${money(v.target, v.currency)} or less at a real shop.`,
    );
  const stop = () => w && call(`/api/watches/${encodeURIComponent(w.id)}/stop`, {}, () => "You stopped watching this price.");
  const Line = variant === "panel" ? WatchPanel : WatchLine;

  return (
    <div className="watch-slot">
      {w ? (
        <>
          <Line w={w} busy={busy} lineRef={lineRef} onStop={w.example ? undefined : stop} updates={updates} />
          {paymentId && (w.status === "stopped" || w.status === "expired") && (
            <button type="button" className="btn btn-quiet watch-stop" aria-disabled={busy || undefined} onClick={start}>
              <Eye size={16} strokeWidth={2.2} aria-hidden="true" /> {busy ? "Starting" : "Watch the price again"}
            </button>
          )}
        </>
      ) : (
        paymentId && (
          <div className="watch-offer">
            <p>Too dear? Spotter can watch real shop prices (Channel3) for two weeks and tell you if it comes down. Nothing is bought.</p>
            <button type="button" className="btn btn-quiet" aria-disabled={busy || undefined} onClick={start}>
              <Eye size={16} strokeWidth={2.2} aria-hidden="true" /> {busy ? "Starting" : "Watch the price"}
            </button>
          </div>
        )
      )}
      {error && (
        <p ref={errRef} tabIndex={-1} className="error-line" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" role="status">
        {said}
      </p>
    </div>
  );
}

/**
 * Payments whose price is worth watching: held, denied or stopped, for a named product that costs more than the
 * cheapest real shop. Never a shop that looked fake or hid orders for AI agents (src/core/market.ts priceWatchFits).
 */
export const watchable = priceWatchFits;
