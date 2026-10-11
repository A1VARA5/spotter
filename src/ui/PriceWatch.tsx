"use client";
// Price watch on a payment: after a payment was too dear, held or denied, the spotter can ask Spotter to watch the
// price at real shops (Channel3) for 14 days. A drop is shown here and sent to the spotter's alert channels. Nothing
// is ever bought: the line only says where and for how much, with a link to the shop's own page.
import { useEffect, useRef, useState } from "react";
import { Eye, TrendingDown } from "lucide-react";
import type { WatchView } from "@/core/watch";
import { priceWatchFits } from "@/core/market";
import { money } from "./format";
import { plainError, readJson } from "./http";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const safeLink = (u: string) => (/^https:\/\//.test(u) ? u : "");

/** A tiny line of the price over time. Decorative: the words next to it say the same thing. */
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

function WatchLine({ w, onStop, busy, lineRef }: { w: WatchView; onStop?: () => void; busy: boolean; lineRef: React.RefObject<HTMLParagraphElement | null> }) {
  const who = w.who ?? "they";
  const tag = w.example ? <span className="case-example"> · Example, checked earlier</span> : null;
  if (w.status === "dropped" && w.best) {
    const link = safeLink(w.best.url);
    return (
      <div className="watch" data-state="dropped">
        <p className="watch-head">
          <TrendingDown size={16} strokeWidth={2.2} aria-hidden="true" /> Price dropped{tag}
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
          <Eye size={16} strokeWidth={2.2} aria-hidden="true" /> Watching the price until {day(w.expiresAt)}
          {tag}
        </p>
        <p ref={lineRef} tabIndex={-1} className="watch-line">
          Spotter tells you if a real shop sells it for {money(w.target, w.currency)} or less.
          {w.best ? ` Best real price now: ${money(w.best.price, w.currency)} at ${w.best.shop}.` : ""}
        </p>
        <Spark w={w} />
        {onStop && (
          <button type="button" className="btn btn-quiet watch-stop" aria-disabled={busy || undefined} onClick={() => !busy && onStop()}>
            {busy ? "Stopping" : "Stop watching"}
          </button>
        )}
      </div>
    );
  }
  return (
    <p ref={lineRef} tabIndex={-1} className="watch-ended">
      {w.status === "stopped" ? "You stopped watching this price." : `Price watch ended on ${day(w.expiresAt)} without a drop.`}
    </p>
  );
}

/**
 * The watch for one payment, or the button that starts one. Spotter only, no PIN: watching moves no money.
 * Focus moves to the result line after either button, like the rest of the dashboard.
 */
export function PriceWatch({ watch, paymentId, onChanged }: { watch?: WatchView; paymentId?: string; onChanged?: () => void }) {
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
      v.status === "dropped" ? "A real shop already has it for less." : `Watching the price. Spotter tells you if a real shop sells it for ${money(v.target, v.currency)} or less.`,
    );
  const stop = () => w && call(`/api/watches/${encodeURIComponent(w.id)}/stop`, {}, () => "You stopped watching this price.");

  return (
    <div className="watch-slot">
      {w ? (
        <>
          <WatchLine w={w} busy={busy} lineRef={lineRef} onStop={w.example ? undefined : stop} />
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
