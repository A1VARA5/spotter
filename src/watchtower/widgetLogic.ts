// The sums and words behind Spotter's signature widgets, kept out of React so they can be tested.
import { networkLine } from "@/core/networkLine";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** PayPal keeps an authorisation for about three days before the honour period ends. */
const PAYPAL_HOLD = 3 * DAY;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type Countdown = { text: string; about: boolean; expired: boolean; elapsed: number };

/** How long PayPal will keep holding the money. Without PayPal's own expiry, a labelled guess. */
export function countdown(expires: Date | null, heldSince: Date, now: Date): Countdown {
  const about = !expires;
  const end = expires ?? new Date(heldSince.getTime() + PAYPAL_HOLD);
  const left = end.getTime() - now.getTime();
  const total = Math.max(end.getTime() - heldSince.getTime(), 1);
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - heldSince.getTime()) / total));
  if (left <= 0) return { text: "PayPal's hold has run out", about, expired: true, elapsed: 1 };
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / 60_000);
  const parts = days > 0 ? [plural(days, "day"), hours ? plural(hours, "hour") : ""] : hours > 0 ? [plural(hours, "hour"), minutes ? plural(minutes, "minute") : ""] : [plural(Math.max(minutes, 1), "minute")];
  return { text: `expires in ${about ? "about " : ""}${parts.filter(Boolean).join(" ")}`, about, expired: false, elapsed };
}

export const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

export type ReplayRow = { when: Date; amount: number; outcome: string; who: string; payee: string };
export type ReplayDay = { date: Date; kept: number; gone: number; protectedSoFar: number; events: Array<Omit<ReplayRow, "when">> };

const STEPPED_IN = new Set(["Stopped", "Denied", "Protected"]);
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The month replayed a day at a time. "Kept" is money Spotter stopped or the spotter denied. "Gone" is
 * what would have left without Spotter: that, plus payments it switched to buyer protection.
 */
export function replayDays(rows: ReplayRow[], now: Date): ReplayDay[] {
  if (!rows.length) return [];
  const startOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = startOf(now);
  const first = Math.max(Math.min(...rows.map((r) => startOf(r.when))), today - 30 * DAY);
  const days: ReplayDay[] = [];
  let kept = 0;
  let gone = 0;
  let prot = 0;
  for (let t = first; t <= today; t += DAY) {
    const events = rows
      .filter((r) => STEPPED_IN.has(r.outcome) && startOf(r.when) === t)
      .sort((a, b) => a.when.getTime() - b.when.getTime())
      .map(({ amount, outcome, who, payee }) => ({ amount, outcome, who, payee }));
    for (const e of events) {
      gone += e.amount;
      if (e.outcome === "Protected") prot += e.amount;
      else kept += e.amount;
    }
    days.push({ date: new Date(t), kept: round(kept), gone: round(gone), protectedSoFar: round(prot), events });
  }
  return days;
}

const ATTENTION = ["Stopped", "Denied", "Waiting", "Protected"];

/** Which payment a case file shows: the newest one Spotter stepped in on, else the newest. */
export function pickCase(rows: Array<{ id: string; when: Date; outcome: string }>): string | null {
  const newest = [...rows].sort((a, b) => b.when.getTime() - a.when.getTime());
  return (newest.find((r) => ATTENTION.includes(r.outcome)) ?? newest[0])?.id ?? null;
}

/** demo: the count is other demo families (a demo family's count never includes real families, src/core/network.ts). */
export type RadarCount = { families: number; sample?: boolean; demo?: boolean };
export type RadarLine = { payee: string; families: number; sample: boolean; demo: boolean; text: string };
export const radarKey = (payee: string) => payee.trim().toLowerCase();

/** The family's stopped or denied payees, with how many other families' spotters said no to them. */
export function radarLines(rows: Array<{ payee: string; outcome: string }>, counts: Record<string, RadarCount>): RadarLine[] {
  const seen = new Map<string, string>();
  for (const r of rows) if ((r.outcome === "Stopped" || r.outcome === "Denied") && !seen.has(radarKey(r.payee))) seen.set(radarKey(r.payee), r.payee.trim());
  return [...seen.entries()]
    .map(([key, payee]) => {
      const c = counts[key];
      const families = c?.families ?? 0;
      const demo = c?.demo ?? false;
      return { payee, families, sample: c?.sample ?? false, demo, text: networkLine({ families, demo }, "this payee") };
    })
    .sort((a, b) => b.families - a.families || a.payee.localeCompare(b.payee));
}

/** A tile shows the first few (already sorted most important first) and says how many more there are. */
export function firstFew<T>(list: T[], n: number): { shown: T[]; more: number } {
  return { shown: list.slice(0, n), more: Math.max(0, list.length - n) };
}

// ---------- fair price ----------

/** A payments row as the fair price widget reads it (prices in pounds, from Channel3's stored check). */
export type PriceRow = {
  id: string;
  when: Date;
  who: string;
  kind: string;
  payee: string;
  amount: number;
  outcome: string;
  marketCheapest: number | null;
  marketMedian: number | null;
  priceGap: number | null;
  marketShop: string;
  marketItem: string;
  sample: boolean;
};
export type PriceVerdict = "fake" | "over" | "under" | "fair";
export type PriceItem = Omit<PriceRow, "when" | "kind" | "marketCheapest" | "marketMedian" | "priceGap"> & { cheapest: number; median: number; gap: number; verdict: PriceVerdict };
export type FairPrice = {
  checked: number;
  overpaid: number;
  /** Paid under the cheapest real shop, leaving out prices too cheap to be real: those are a scam sign, not a saving. */
  saved: number;
  headline: string;
  caught: string | null;
  /** A paid price far below real shops (a fake shop sign), said on its own line. */
  warning: string | null;
  items: PriceItem[];
};

/** Under 40% of the going rate is a fake shop tell, the same line the payment check uses. */
const TOO_CHEAP = 0.4;
const NOTICEABLE = 0.5;
const MAX_ITEMS = 5;
const STOPPED_IN = new Set(["Stopped", "Denied", "Waiting"]);

/** £18, £3.50, £24.99: whole pounds without pence. */
export const poundsShort = (n: number) => `£${Number.isInteger(round(n)) ? round(n).toLocaleString("en-GB") : round(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function verdictOf(amount: number, cheapest: number, median: number): PriceVerdict {
  if (amount < median * TOO_CHEAP) return "fake";
  if (amount - cheapest >= NOTICEABLE) return "over";
  if (amount - cheapest <= -NOTICEABLE) return "under";
  return "fair";
}

/**
 * What the family paid against the cheapest real retailer this month (last 30 days), from the price
 * checks Spotter stored when each payment was made. Only paid payments count towards overpaid or saved;
 * a fake shop price Spotter stopped is called out on its own.
 */
export function fairPrice(rows: PriceRow[], now: Date, maxItems = MAX_ITEMS): FairPrice {
  const checked = rows.filter((r) => r.marketCheapest !== null && r.marketMedian !== null && now.getTime() - r.when.getTime() <= 30 * DAY);
  if (!checked.length) return { checked: 0, overpaid: 0, saved: 0, headline: "", caught: null, warning: null, items: [] };
  const items: PriceItem[] = checked.map(({ when: _w, kind: _k, marketCheapest, marketMedian, priceGap, ...rest }) => {
    const cheapest = marketCheapest!;
    const gap = priceGap ?? round(rest.amount - cheapest);
    return { ...rest, cheapest, median: marketMedian!, gap, verdict: verdictOf(rest.amount, cheapest, marketMedian!) };
  });
  const paidAll = items.filter((i) => i.outcome === "Paid");
  // Far below the going rate is what fake shops charge: never a saving, and never "fair".
  const paidFake = paidAll.filter((i) => i.verdict === "fake").sort((a, b) => b.median - b.amount - (a.median - a.amount));
  const paid = paidAll.filter((i) => i.verdict !== "fake");
  const overpaid = round(paid.reduce((t, i) => t + Math.max(i.gap, 0), 0));
  const saved = round(paid.reduce((t, i) => t + Math.max(-i.gap, 0), 0));

  const fairIds = new Set(paid.map((i) => i.id));
  const payers = [...new Set(checked.filter((r) => fairIds.has(r.id)).map((r) => r.who))];
  const onlyKind = payers.length === 1 ? checked.find((r) => r.who === payers[0])!.kind : "";
  const label = payers.length > 1 ? "Everyone together" : onlyKind === "AI agent" ? "Your agent" : (payers[0] ?? "");
  const whoOf = (i: PriceItem) => (checked.find((r) => r.id === i.id)?.kind === "AI agent" ? "Your agent" : i.who);
  const fake0 = paidFake[0];
  const warning = fake0
    ? `${whoOf(fake0)} paid ${poundsShort(fake0.amount)} for "${fake0.marketItem || fake0.payee}" that real shops sell for around ${poundsShort(fake0.median)}: far too cheap, a common sign of a fake shop`
    : null;
  const headline = !paid.length
    ? paidFake.length
      ? "Check what was paid for: a price looked too good to be real"
      : "Nothing paid this month had a price check yet"
    : overpaid >= NOTICEABLE
      ? `${label} paid ${poundsShort(overpaid)} more than the cheapest real shop this month`
      : paidFake.length
        ? "Nothing overpaid this month, but one price looked too good to be real"
        : `${label} paid fair prices this month: never more than the cheapest real shop`;

  const stopped = items.filter((i) => STOPPED_IN.has(i.outcome)).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const fake = stopped.find((i) => i.verdict === "fake");
  const dear = stopped.find((i) => i.verdict === "over");
  const name = (i: PriceItem) => `"${i.marketItem || i.payee}"`;
  const caught = fake
    ? `Spotter caught a ${poundsShort(fake.amount)} ${name(fake)} that real shops sell for around ${poundsShort(fake.median)}`
    : dear
      ? `Spotter stopped ${poundsShort(dear.amount)} for ${name(dear)} that the cheapest real shop sells for ${poundsShort(dear.cheapest)}`
      : null;

  return { checked: checked.length, overpaid, saved, headline, caught, warning, items: [...items].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, maxItems) };
}

export type WatchSummaryRow = { status: string; saving: number };

/** The price watches widget's headline: what the drops come to against what was nearly paid, or what is being watched. */
export function watchSummary(rows: WatchSummaryRow[]): { watching: number; dropped: number; saved: number; headline: string } {
  const watching = rows.filter((r) => r.status === "Watching").length;
  const drops = rows.filter((r) => r.status === "Dropped");
  const saved = round(drops.reduce((t, r) => t + r.saving, 0));
  const headline = saved > 0
    ? `${poundsShort(saved)} less than nearly paid, from ${plural(drops.length, "price drop")}`
    : watching
      ? `Watching ${plural(watching, "price")}`
      : rows.length
        ? "No price drops this time"
        : "No price watches yet";
  return { watching, dropped: drops.length, saved, headline };
}
