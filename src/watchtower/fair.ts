// The fair price question, answered by code in one tool call (fair_prices) instead of a hand off to Studio's
// data agent: the same 30 day price checks the fair price widget reads, plus today's real shop prices for
// the biggest paid items (Channel3, through /api/watchtower/price and the payment check's filtered market).
// That cut two model turns from the first question a judge clicks.
import type { PaymentRow } from "./data";
import type { PriceSummary } from "./price";
import { fairPrice, type PriceItem, type PriceRow } from "./widgetLogic";

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

export type PriceSign = "too_cheap_to_be_real" | "over_cheapest" | "under_cheapest" | "about_cheapest";

const SIGN: Record<PriceItem["verdict"], PriceSign> = { fake: "too_cheap_to_be_real", over: "over_cheapest", under: "under_cheapest", fair: "about_cheapest" };

/** One plain sentence per item, so the assistant can't turn a fake shop price into a bargain or a stopped payment into a purchase. */
function meaningOf(i: PriceItem): string {
  const paid = i.outcome === "Paid";
  const notPaid = i.outcome === "Waiting" ? "Waiting for the spotter: nothing was paid yet." : `${i.outcome}: nothing was paid for this, so it is not a purchase.`;
  if (i.verdict === "fake")
    return paid
      ? "Paid far below what real shops charge. That is a common sign of a fake shop, so it is not a saving and never a good price. Suggest checking the item arrives and is genuine."
      : `Priced far below what real shops charge, a common sign of a fake shop. ${notPaid}`;
  if (!paid) return notPaid;
  if (i.verdict === "over") return "Paid more than the cheapest real shop at the time.";
  if (i.verdict === "under") return "Paid a little less than the cheapest real shop at the time.";
  return "Paid about what the cheapest real shop charged at the time.";
}

export type FairBrief = {
  headline: string;
  /** A paid price far below real shops, worded as a warning. Null when there's none. */
  warning: string | null;
  /** Payments this month with a price check, and how many of those were paid. */
  checked: number;
  paidChecked: number;
  /** Paid minus the cheapest real shop at the time, summed over paid payments (pounds). */
  overpaid: number;
  /** Paid under the cheapest real shop, leaving out prices too cheap to be real. */
  saved: number;
  /** Every checked payment is from the made up sample month. */
  allSample: boolean;
  /** Prices far below the going rate (a fake shop sign), paid or not. Never savings. */
  tooCheap: Array<{ item: string; payee: string; who: string; amount: number; wasPaid: boolean; goingRate: number }>;
  /** Biggest price gaps first. `wasPaid` is false for stopped, denied or waiting payments. No payment ids: the family never needs them. */
  items: Array<{
    item: string;
    payee: string;
    who: string;
    amount: number;
    wasPaid: boolean;
    outcome: string;
    priceSign: PriceSign;
    meaning: string;
    cheapestThen: number;
    shopThen: string;
    gapToCheapest: number;
    sample: boolean;
  }>;
  /** Item names for today's live check: the biggest paid items, each once. */
  liveItems: string[];
};

export function fairBrief(payments: PaymentRow[], now: Date): FairBrief {
  const rows = payments.map(priceRow);
  const f = fairPrice(rows, now);
  const month = payments.filter((r) => r.marketCheapest !== null && r.marketMedian !== null && now.getTime() - r.when.getTime() <= 30 * 86_400_000);
  const paid = month.filter((r) => r.outcome === "Paid");
  const liveItems = [...new Set([...paid].sort((a, b) => b.amount - a.amount).map((r) => r.marketItem.trim()).filter(Boolean))].slice(0, LIVE_ITEMS);
  // f.items is capped for the widget; the too cheap list looks at every checked row.
  const all = fairPrice(rows, now, Infinity).items;
  return {
    headline: f.headline,
    warning: f.warning,
    checked: f.checked,
    paidChecked: paid.length,
    overpaid: f.overpaid,
    saved: f.saved,
    allSample: month.every((r) => r.sample === "Yes"),
    tooCheap: all
      .filter((i) => i.verdict === "fake")
      .map((i) => ({ item: i.marketItem || i.payee, payee: i.payee, who: i.who, amount: i.amount, wasPaid: i.outcome === "Paid", goingRate: i.median })),
    items: f.items.map((i) => ({
      item: i.marketItem,
      payee: i.payee,
      who: i.who,
      amount: i.amount,
      wasPaid: i.outcome === "Paid",
      outcome: i.outcome,
      priceSign: SIGN[i.verdict],
      meaning: meaningOf(i),
      cheapestThen: i.cheapest,
      shopThen: i.marketShop,
      gapToCheapest: i.gap,
      sample: i.sample,
    })),
    liveItems,
  };
}

export type TodayLine = { item: string; cheapestToday: { shop: string; price: number } | null; listings: number; shops: Array<{ shop: string; price: number }>; note: string; error?: string };

/** A search that failed: the same shape as a result with no price, and told not to fall back on an old figure. */
export function todayUnavailable(item: string, error: string): TodayLine {
  return { item, cheapestToday: null, listings: 0, shops: [], error, note: "Today's price for this item is unavailable. Say so; don't quote the price at the time or guess one as today's." };
}

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
