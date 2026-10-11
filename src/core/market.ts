// Market price check: compares what someone is about to pay with what real retailers charge
// (offers come from Channel3). Pure code evidence, so it can stand next to the AI's flags.
import type { Flag } from "./grounding";
import { formatMoney, type Currency } from "./types";

/**
 * condition is Channel3's offer condition (since July 2026): "new", "used", or null when the shop doesn't say.
 * Channel3 turns "refurbished" into null, so null can hide a refurbished listing: it counts on the new side, which
 * only ever makes "new ones cost at least" lower, never a claim that isn't true.
 */
export type Offer = { title: string; brand?: string; domain: string; price: number; currency: Currency; url: string; condition?: "new" | "used" | null };
/** A "new" item priced below every new offer but inside what used ones sell for, in minor units. */
export type LikeUsed = { newFrom: number; usedLow: number; usedHigh: number };
export type MarketResult = { flag: Flag | null; median?: number; offers: number; cheapest?: Offer; likeUsed?: LikeUsed };

const TOO_CHEAP = 0.4; // under 40% of the going rate: classic fake shop
const TOO_DEAR = 1.3; // over 130%: you're overpaying
const MIN_SIDE = 2; // offers needed on each side (new and used) before saying "priced like a used one"

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const USED_WORDS = /\b(used|refurb(ished)?|renewed|pre[\s-]?owned|pre[\s-]?loved|second[\s-]?hand|ex[\s-]?display|open[\s-]?box|reconditioned)\b/i;

/** True when the item is sold as used, refurbished or similar, so a used price is expected. */
export function claimsUsed(text: string | undefined | null): boolean {
  return Boolean(text && USED_WORDS.test(text));
}

const isUsed = (o: Offer) => o.condition === "used";

/**
 * The new side and the used side of the same product's offers, in one currency. Null unless both sides have at least
 * two offers and the amount sits below every new offer and inside the used range.
 */
export function likeUsed(amount: number, currency: Currency, offers: Offer[]): LikeUsed | null {
  const same = offers.filter((o) => o.currency === currency && o.price > 0);
  const used = same.filter(isUsed).map((o) => o.price);
  const fresh = same.filter((o) => !isUsed(o)).map((o) => o.price);
  if (used.length < MIN_SIDE || fresh.length < MIN_SIDE) return null;
  const newFrom = Math.min(...fresh);
  const usedLow = Math.min(...used);
  const usedHigh = Math.max(...used);
  return amount < newFrom && amount >= usedLow && amount <= usedHigh ? { newFrom, usedLow, usedHigh } : null;
}

/** "Priced like a used one. New ones cost at least £679.00." */
export const likeUsedText = (l: LikeUsed, currency: Currency) => `Priced like a used one. New ones cost at least ${formatMoney({ amount: l.newFrom, currency })}.`;

export type PriceVerdict = "too_cheap" | "overpriced" | "normal" | "like_used";

/** What the market check concluded, or null when it had too few offers to say. */
export function priceVerdict(m: MarketResult | null | undefined): PriceVerdict | null {
  if (!m || m.median === undefined) return null;
  if (!m.flag) return "normal";
  if (m.flag.severity === "high") return "too_cheap";
  return m.likeUsed ? "like_used" : "overpriced";
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
  const said = {
    too_cheap: "far below the going rate (a fake shop tell)",
    overpriced: "overpriced, well over the going rate",
    normal: "a normal price",
    like_used: "priced like a used one, below every new listing",
  }[verdict];
  const cheapest = m.cheapest ? ` The cheapest listing found was ${money(m.cheapest.price)} ("${clean(m.cheapest.title)}"), which may not be the exact same product.` : "";
  const used = m.likeUsed
    ? ` New ones cost at least ${money(m.likeUsed.newFrom)}; used ones sell for ${money(m.likeUsed.usedLow)} to ${money(m.likeUsed.usedHigh)}, and this price is inside that range.`
    : "";
  return `Spotter's market check, done by code from real retailer listings for "${clean(m.item)}": around ${money(m.median)} across ${m.offers} retailers. This payment is ${money(amount)}, which is ${said}.${used}${cheapest}`;
}

/**
 * The going rate comes from new offers (and ones whose condition isn't known); used offers only count for "priced like
 * a used one", which is checked unless the item says it is used or refurbished itself.
 */
export function priceCheck(amount: number, currency: Currency, offers: Offer[], opts: { item?: string } = {}): MarketResult {
  const lu = claimsUsed(opts.item) ? null : likeUsed(amount, currency, offers);
  const base = goingRate(amount, currency, offers.filter((o) => !isUsed(o)));
  if (!lu || base.median === undefined) return base;
  if (base.flag) return { ...base, likeUsed: lu }; // the fake shop or overpaying flag stays the one flag
  return { ...base, likeUsed: lu, flag: { kind: "price", severity: "medium", quote: "", why: likeUsedText(lu, currency) } };
}

function goingRate(amount: number, currency: Currency, offers: Offer[]): MarketResult {
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
