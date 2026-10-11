// Watchtower's live price check: the Spotter agent asks "what do real shops charge for this?" and gets
// Channel3's real retailer prices back. Only the item name the agent passes goes to Channel3 (never the
// payment's message or any other untrusted text), searches go through the same cache as the payment
// check, and each family has a daily cap so a chatty assistant can't burn the Channel3 credits.
import type { Db } from "@/db";
import type { Offer } from "@/core/market";
import type { Currency } from "@/core/types";
import { cap } from "./llm";

export const MAX_QUERY = 120;
const MAX_SHOPS = 5;

export type PriceSummary = {
  item: string;
  currency: Currency;
  offers: number;
  cheapest: { shop: string; price: number } | null;
  median: number | null;
  shops: Array<{ shop: string; price: number }>;
};

export type Market = (item: string, currency: Currency) => Promise<Offer[] | null>;

// Control characters, zero width and bidi marks: nothing a real item name needs.
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

/** A tidy item name of 2 to 120 characters, or null. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_QUERY * 2) return null;
  const q = raw.replace(HIDDEN, "").replace(/\s+/g, " ").trim();
  return q.length >= 2 && q.length <= MAX_QUERY ? q : null;
}

const pounds = (minor: number) => Math.round(minor) / 100;

/** Cheapest and median real retailer price in pounds, with the cheapest few shops (one line each). */
export function summarisePrices(item: string, offers: Offer[], currency: Currency): PriceSummary {
  // New prices only: a used listing isn't what the family would pay for a new one.
  const same = offers.filter((o) => o.condition !== "used" && o.currency === currency && o.price > 0);
  const byShop = new Map<string, number>();
  for (const o of same) byShop.set(o.domain, Math.min(o.price, byShop.get(o.domain) ?? Infinity));
  const shops = [...byShop.entries()].sort((a, b) => a[1] - b[1]).map(([shop, price]) => ({ shop, price: pounds(price) }));
  const sorted = same.map((o) => o.price).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = !sorted.length ? null : sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return { item, currency, offers: same.length, cheapest: shops[0] ?? null, median: median === null ? null : pounds(median), shops: shops.slice(0, MAX_SHOPS) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function makePriceCheck(opts: { db: Db; market: Market; perHousehold?: number; overall?: number }) {
  const { db, market } = opts;
  const perHousehold = opts.perHousehold ?? cap("WATCHTOWER_PRICE_CHECKS_PER_FAMILY", 20);
  const overall = opts.overall ?? cap("WATCHTOWER_PRICE_CHECKS_PER_DAY", 300);
  return async (householdId: string, body: unknown): Promise<Response> => {
    const b = body as { query?: unknown; currency?: unknown } | null;
    const query = cleanQuery(b?.query);
    if (!query) return json({ error: `Send the item's name only, 2 to ${MAX_QUERY} characters.` }, 400);
    const currency: Currency = b?.currency === "USD" ? "USD" : "GBP";

    // Take a slot only when there is one, in one statement, like the assistant's turns.
    const took = await db.query(
      `insert into price_checks (household_id) select $1
       where (select count(*) from price_checks where at > now() - interval '1 day') < $2
         and (select count(*) from price_checks where household_id = $1 and at > now() - interval '1 day') < $3
       returning 1`,
      [householdId, overall, perHousehold],
    );
    if (!took.length) return json({ error: "Spotter has done all the price checks it can today. Try again tomorrow." }, 429);

    let offers: Offer[] | null;
    try {
      offers = await market(query, currency);
    } catch (e) {
      console.error(`[spotter] watchtower price check failed for ${householdId}:`, e instanceof Error ? e.message : e);
      offers = null;
    }
    if (!offers) return json({ error: "Real shop price search is unavailable right now. Try again in a minute." }, 502);
    return json({ result: summarisePrices(query, offers, currency) });
  };
}
