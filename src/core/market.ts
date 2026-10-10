// Market price check: compares what someone is about to pay with what real retailers charge
// (offers come from Channel3). Pure code evidence, so it can stand next to the AI's flags.
import type { Flag } from "./grounding";
import { formatMoney, type Currency } from "./types";

export type Offer = { title: string; brand?: string; domain: string; price: number; currency: Currency; url: string };
export type MarketResult = { flag: Flag | null; median?: number; offers: number; cheapest?: Offer };

const TOO_CHEAP = 0.4; // under 40% of the going rate: classic fake shop
const TOO_DEAR = 1.3; // over 130%: you're overpaying

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export type PriceVerdict = "too_cheap" | "overpriced" | "normal";

/** What the market check concluded, or null when it had too few offers to say. */
export function priceVerdict(m: MarketResult | null | undefined): PriceVerdict | null {
  if (!m || m.median === undefined) return null;
  if (!m.flag) return "normal";
  return m.flag.severity === "high" ? "too_cheap" : "overpriced";
}

const PRICE = /\bpric/i;
const SAYS_NORMAL = /\b(normal|fair|reasonable|typical|usual|standard|in line|about right|going rate|market rate|competitive)\b/i;
const SAYS_DEAR = /\b(overpriced|overcharg\w*|well over|over the going|above (the )?(going|market|usual)|too (expensive|dear|much)|pricier|more than (real )?(shops|retailers))\b/i;
const SAYS_CHEAP = /\b(too cheap|far below|well below|suspiciously (cheap|low)|unrealistically (cheap|low)|too good to be true|much cheaper than)\b/i;

/** True when a sentence says something about the price that Spotter's own market check disproves. */
export function contradictsPrice(text: string, verdict: PriceVerdict | null): boolean {
  if (!verdict) return false;
  const normal = PRICE.test(text) && SAYS_NORMAL.test(text);
  const dear = SAYS_DEAR.test(text);
  const cheap = SAYS_CHEAP.test(text);
  if (verdict === "normal") return dear || cheap;
  if (verdict === "overpriced") return (normal && !dear) || cheap;
  return (normal && !cheap) || dear;
}

/** The market result as plain facts, for prompts that must not contradict it. */
export function marketFacts(m: (MarketResult & { item: string }) | null | undefined, amount: number, currency: Currency): string | null {
  const verdict = priceVerdict(m);
  if (!m || !verdict || m.median === undefined) return null;
  const money = (minor: number) => formatMoney({ amount: minor, currency });
  // Item and listing titles come from outside (the request, the retailer feed): no markup, kept short.
  const clean = (t: string) => t.replace(/[<>"\r\n]/g, " ").slice(0, 80).trim();
  const said = { too_cheap: "far below the going rate (a fake shop tell)", overpriced: "overpriced, well over the going rate", normal: "a normal price" }[verdict];
  const cheapest = m.cheapest ? ` The cheapest listing found was ${money(m.cheapest.price)} ("${clean(m.cheapest.title)}"), which may not be the exact same product.` : "";
  return `Spotter's market check, done by code from real retailer listings for "${clean(m.item)}": around ${money(m.median)} across ${m.offers} retailers. This payment is ${money(amount)}, which is ${said}.${cheapest}`;
}

export function priceCheck(amount: number, currency: Currency, offers: Offer[]): MarketResult {
  const same = offers.filter((o) => o.currency === currency && o.price > 0);
  if (same.length < 2) return { flag: null, offers: same.length };
  const m = median(same.map((o) => o.price));
  const cheapest = same.reduce((a, b) => (b.price < a.price ? b : a));
  const money = (minor: number) => formatMoney({ amount: minor, currency });

  if (amount < m * TOO_CHEAP) {
    return {
      median: m,
      offers: same.length,
      cheapest,
      flag: {
        kind: "price",
        severity: "high",
        quote: "",
        why: `${money(amount)} is far below what real shops charge (around ${money(m)} across ${same.length} retailers). Prices this low are a fake shop tell.`,
      },
    };
  }
  if (amount > m * TOO_DEAR) {
    return {
      median: m,
      offers: same.length,
      cheapest,
      flag: {
        kind: "price",
        severity: "medium",
        quote: "",
        why: `That's well over the going rate. ${cheapest.domain} sells it for ${money(cheapest.price)}.`,
      },
    };
  }
  return { flag: null, median: m, offers: same.length, cheapest };
}
