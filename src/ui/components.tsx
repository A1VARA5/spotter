// Shared presentational pieces: brand, top bar, the hold track, evidence with in place highlights.
import Link from "next/link";
import { Ban, Hand, ShieldCheck, Check, RotateCcw, CircleAlert, Loader, Store } from "lucide-react";
import { findQuotes, money, STATE_LABEL, type TrackState } from "./format";
import type { Flag } from "@/core/grounding";
import type { MarketResult } from "@/core/market";

export function BrandMark() {
  // A bar resting on two spotting hands: the product's idea in one mark.
  return (
    <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="6" width="24" height="5" rx="2.5" fill="#17212b" />
      <rect x="5" y="13" width="5" height="10" rx="2.5" fill="#f2b705" />
      <rect x="18" y="13" width="5" height="10" rx="2.5" fill="#f2b705" />
    </svg>
  );
}

export function TopBar({ current }: { current?: "home" | "dashboard" | "demo" | "ledger" }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Spotter home">
        <BrandMark />
        Spotter
      </Link>
      <nav className="nav" aria-label="Main">
        <Link className="nav-link" href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>
          Dashboard
        </Link>
        <Link className="nav-link" href="/ledger" aria-current={current === "ledger" ? "page" : undefined}>
          Ledger
        </Link>
        <Link className="nav-link" href="/demo" aria-current={current === "demo" ? "page" : undefined}>
          Try it
        </Link>
      </nav>
    </header>
  );
}

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
      <span className="track-gate" aria-hidden="true">
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
  return <blockquote className="evidence">{parts}</blockquote>;
}

/** What real shops charge for the same item (Channel3), next to what's about to be paid. */
export function MarketNote({ market, currency }: { market: (MarketResult & { item: string }) | null; currency: string }) {
  if (!market || !market.cheapest || !market.median) return null;
  return (
    <p className="market">
      <Store className="market-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>
        Real shops sell {market.item} from{" "}
        <a href={market.cheapest.url} target="_blank" rel="noopener noreferrer nofollow">
          {money(market.cheapest.price, currency)} at {market.cheapest.domain}
        </a>
        , around {money(market.median, currency)} across {market.offers} retailers.{" "}
        <span className="market-src">Prices from Channel3.</span>
      </span>
    </p>
  );
}
