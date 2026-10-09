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
