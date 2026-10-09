// Channel3 product search: real retailer offers for an item, used as price evidence and for agent shopping.
// Docs: docs/channel3/ (https://docs.trychannel3.com). Cached in Postgres so repeat checks cost no credits.
import type { Db } from "@/db";
import type { Offer } from "@/core/market";
import type { Currency } from "@/core/types";

const BASE = "https://api.trychannel3.com";
const TIMEOUT_MS = 8_000;
const CACHE_DAYS = 7;

type C3Offer = { url: string; domain: string; price?: { price: number; currency: string } | null; availability?: string };
type C3Product = { id: string; title: string; brands?: Array<{ name: string }>; offers?: C3Offer[]; images?: Array<{ url: string }> };

export type Product = { id: string; title: string; brand?: string; image?: string; offers: Offer[] };

const COUNTRY: Record<Currency, string> = { GBP: "GB", USD: "US" };

function toOffers(p: C3Product, currency: Currency): Offer[] {
  return (p.offers ?? [])
    .filter((o) => o.price && o.price.currency === currency && o.availability !== "OutOfStock")
    .map((o) => ({
      title: p.title,
      brand: p.brands?.[0]?.name,
      domain: o.domain,
      price: Math.round(o.price!.price * 100),
      currency,
      url: o.url,
    }));
}

/** Raw search. Returns null (not []) when Channel3 can't be reached, so callers never mistake an outage for "no offers". */
export async function searchProducts(query: string, currency: Currency, limit = 8): Promise<Product[] | null> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}/v1/search`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 200), limit, config: { country: COUNTRY[currency], currency } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`[spotter] Channel3 search failed: ${r.status}`);
      return null;
    }
    const j = (await r.json()) as { products?: C3Product[] };
    return (j.products ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      brand: p.brands?.[0]?.name,
      image: p.images?.[0]?.url,
      offers: toOffers(p, currency),
    }));
  } catch (e) {
    console.error("[spotter] Channel3 search error:", e instanceof Error ? e.message : e);
    return null;
  }
}

const ACCESSORY = /\b(tips?|case|cases|cover|covers|strap|straps|charger|cable|replacement|protector|skin|stand|holder|refill)\b/i;
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Is this listing the same product as the item? Every model number must appear; one other word may be missing (often the brand). */
export function sameProduct(item: string, title: string): boolean {
  if (ACCESSORY.test(title) && !ACCESSORY.test(item)) return false;
  const have = new Set(tokens(title));
  const want = tokens(item);
  const numeric = want.filter((t) => /\d/.test(t));
  const words = want.filter((t) => !/\d/.test(t));
  if (!numeric.every((t) => have.has(t))) return false;
  if ([...have].some((t) => /\d/.test(t) && !numeric.includes(t) && /^\d+$/.test(t) && numeric.some((n) => /^\d+$/.test(n)))) return false;
  return words.filter((t) => !have.has(t)).length <= 1;
}

/** Offers pooled from every listing of the same product. Empty when nothing matches: no guess is better than a wrong one. */
export function offersFor(products: Product[], item: string): Offer[] {
  return products.filter((p) => sameProduct(item, p.title)).flatMap((p) => p.offers);
}

/** Cached lookup used by the payment check. */
export function makeMarket(db: Db) {
  return async (item: string, currency: Currency): Promise<Offer[] | null> => {
    const key = `${currency}:${item.trim().toLowerCase()}`;
    const hit = await db.query<{ offers: Offer[] }>(
      `select offers from market_cache where key = $1 and fetched_at > now() - interval '${CACHE_DAYS} days'`,
      [key],
    );
    if (hit[0]) return hit[0].offers;
    const products = await searchProducts(item, currency);
    if (!products) return null;
    const offers = offersFor(products, item);
    await db.query(
      "insert into market_cache (key, offers) values ($1, $2) on conflict (key) do update set offers = excluded.offers, fetched_at = now()",
      [key, JSON.stringify(offers)],
    );
    return offers;
  };
}
