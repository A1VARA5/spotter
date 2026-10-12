// Shared presentational pieces: brand, top bar, the hold track, evidence with in place highlights.
import Link from "next/link";
import { Ban, Hand, ShieldCheck, Check, RotateCcw, CircleAlert, Loader, Store } from "lucide-react";
import { findQuotes, money, STATE_LABEL, type TrackState } from "./format";
import type { Flag } from "@/core/grounding";
import { RecName, ShopName } from "./rec";
import { marketSummary, type MarketResult } from "@/core/market";

export function BrandMark() {
  // The hold track in one mark: the money's path, and the yellow clamp that holds it while someone looks.
  return (
    <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="#17212b" />
      <path d="M5 14h18" stroke="#f3f5f2" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="10" y="7.5" width="8" height="13" rx="3" fill="#f2b705" />
      <path d="M12.75 11.5v5M15.25 11.5v5" stroke="#17212b" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function TopBar({ current }: { current?: "home" | "dashboard" | "demo" | "ledger" | "account" }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Spotter home">
        <BrandMark />
        Spotter
      </Link>
      {/* Only the legal pages use this bar, so it links out to what a visitor needs, not the signed in app. */}
      <nav className="nav" aria-label="Main">
        <Link className="nav-link" href="/how">
          How it works
        </Link>
        <Link className="nav-link" href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>
          Dashboard
        </Link>
      </nav>
    </header>
  );
}

/** What each checkpoint state means, for the tooltip on the gate. */
export const STATE_HELP: Record<TrackState, string> = {
  checking: "Spotter is checking the rules and the message.",
  moving: "Within the rules. On its way through PayPal.",
  held: "PayPal is holding the money until you approve or deny.",
  paid: "Approved and captured by PayPal.",
  blocked: "Stopped by a rule or a scam warning. Nothing was paid.",
  failed: "PayPal couldn't complete it. Nothing was paid.",
  protected: "Asked for in a way with no buyer protection, so not sent.",
  returned: "Denied. PayPal cancelled the hold.",
};

const GATE_ICON: Record<TrackState, React.ReactNode> = {
  checking: <Loader size={16} strokeWidth={1.75} />,
  moving: <Check size={16} strokeWidth={1.75} />,
  held: <Hand size={16} strokeWidth={1.75} />,
  paid: <Check size={16} strokeWidth={1.75} />,
  blocked: <Ban size={16} strokeWidth={1.75} />,
  failed: <CircleAlert size={16} strokeWidth={1.75} />,
  protected: <ShieldCheck size={16} strokeWidth={1.75} />,
  returned: <RotateCcw size={16} strokeWidth={1.75} />,
};

export function HoldTrack({ state, from, to, amount, currency }: { state: TrackState; from: string; to: string; amount: number | string; currency: string }) {
  return (
    <div className="track" data-state={state} role="img" aria-label={`${money(amount, currency)} from ${from} to ${to}: ${STATE_LABEL[state]}`}>
      <span className="track-end track-from">{from}</span>
      <span className="track-rail track-rail-a" />
      <span className="track-gate" aria-hidden="true" data-tip={STATE_HELP[state]}>
        {GATE_ICON[state]}
      </span>
      <span className="track-rail track-rail-b" />
      <span className="track-end track-to">{to}</span>
      <span className="track-coin-layer" aria-hidden="true">
        <span className="track-coin num">{money(amount, currency)}</span>
      </span>
    </div>
  );
}

/** The original message or page, with the exact quoted words highlighted where they are. */
export function Evidence({ text, flags }: { text: string; flags: Flag[] }) {
  const quoted = flags.filter((f) => f.quote);
  const ranges = findQuotes(text, quoted.map((f) => f.quote));
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.start > at) parts.push(text.slice(at, r.start));
    const f = quoted[r.i]!;
    parts.push(
      <mark key={r.start} className="mark" data-sev={f.severity} data-kind={f.kind} title={f.why}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    at = r.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  // Long messages scroll inside the box (max-height), so it is a tab stop: keyboard users can scroll it too.
  return (
    <blockquote className="evidence" tabIndex={0} aria-label="The message as it came in">
      {parts}
    </blockquote>
  );
}

/**
 * What real shops charge for the same item (Channel3), next to what's about to be paid. The numbers come from
 * marketSummary, like the reasons line and the Activity column, so the three always agree.
 */
export function MarketNote({ market, currency }: { market: (MarketResult & { item: string }) | null; currency: string }) {
  const s = marketSummary(market);
  if (!market || !s) return null;
  const shop = s.cheapest && /^https:\/\//.test(s.cheapest.url) ? s.cheapest : null;
  return (
    <p className="market">
      <Store className="market-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>
        Real shops sell <RecName>{market.item}</RecName> for around {money(s.median, currency)} across {s.offers} retailers
        {shop && (
          <>
            , from{" "}
            <a href={shop.url} target="_blank" rel="noopener noreferrer nofollow">
              {money(shop.price, currency)} at <ShopName name={shop.domain} />
            </a>
          </>
        )}
        .{" "}
        {market.likeUsed && (
          <>
            <b>Priced like a used one.</b> Used ones sell for {money(market.likeUsed.usedLow, currency)} to {money(market.likeUsed.usedHigh, currency)}; new ones cost at least{" "}
            {money(market.likeUsed.newFrom, currency)}.{" "}
          </>
        )}
        <span className="market-src">Real shop prices (Channel3).</span>
      </span>
    </p>
  );
}
