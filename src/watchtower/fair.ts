// The fair price question, answered by code in one tool call (fair_prices) instead of a hand off to Studio's
// data agent: the same 30 day price checks the fair price widget reads, plus today's real shop prices for
// the biggest paid items (Channel3, through /api/watchtower/price and the payment check's filtered market).
// That cut two model turns from the first question a judge clicks.
import type { PaymentRow } from "./data";
import type { PriceSummary } from "./price";
import { fairPrice, type PriceRow } from "./widgetLogic";

/** How many paid items get a live price check per question: each one is a Channel3 search on the family's cap. */
export const LIVE_ITEMS = 2;

const priceRow = (r: PaymentRow): PriceRow => ({
  id: r.id,
  when: r.when,
  who: r.who,
  kind: r.kind,
  payee: r.payee,
  amount: r.amount,
  outcome: r.outcome,
  marketCheapest: r.marketCheapest,
  marketMedian: r.marketMedian,
  priceGap: r.priceGap,
  marketShop: r.marketShop,
  marketItem: r.marketItem,
  sample: r.sample === "Yes",
});

export type FairBrief = {
  headline: string;
  /** Payments this month with a price check, and how many of those were paid. */
  checked: number;
  paidChecked: number;
  /** Paid minus the cheapest real shop at the time, summed over paid payments (pounds). */
  overpaid: number;
  saved: number;
  /** Every checked payment is from the made up sample month. */
  allSample: boolean;
  /** Biggest price gaps first. No payment ids: the family never needs them. */
  items: Array<{ item: string; payee: string; who: string; paid: number; outcome: string; cheapestThen: number; shopThen: string; overBy: number; sample: boolean }>;
  /** Item names for today's live check: the biggest paid items, each once. */
  liveItems: string[];
};

export function fairBrief(payments: PaymentRow[], now: Date): FairBrief {
  const f = fairPrice(payments.map(priceRow), now);
  const month = payments.filter((r) => r.marketCheapest !== null && r.marketMedian !== null && now.getTime() - r.when.getTime() <= 30 * 86_400_000);
  const paid = month.filter((r) => r.outcome === "Paid");
  const liveItems = [...new Set([...paid].sort((a, b) => b.amount - a.amount).map((r) => r.marketItem.trim()).filter(Boolean))].slice(0, LIVE_ITEMS);
  return {
    headline: f.headline,
    checked: f.checked,
    paidChecked: paid.length,
    overpaid: f.overpaid,
    saved: f.saved,
    allSample: month.every((r) => r.sample === "Yes"),
    items: f.items.map((i) => ({ item: i.marketItem, payee: i.payee, who: i.who, paid: i.amount, outcome: i.outcome, cheapestThen: i.cheapest, shopThen: i.marketShop, overBy: i.gap, sample: i.sample })),
    liveItems,
  };
}

export type TodayLine = { item: string; cheapestToday: { shop: string; price: number } | null; listings: number; shops: Array<{ shop: string; price: number }>; note: string };

/**
 * Today's search, worded for the assistant. The middle price is left out on purpose: a search matches on the
 * item's name, so "Steel kettle 1.7L" also finds £90 designer kettles, and their middle price once came out as
 * "the usual price". The cheapest real shop is the useful number.
 */
export function todayLine(s: PriceSummary): TodayLine {
  return {
    item: s.item,
    cheapestToday: s.cheapest,
    listings: s.offers,
    shops: s.shops.slice(0, 3),
    note: s.cheapest
      ? "Matched on the item's name, so these listings can include other brands and models. Quote the cheapest as a rough guide to today's price."
      : "No real shop listing matched this item today. Say so; don't guess a price.",
  };
}
