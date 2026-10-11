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

/** The one listing to watch when several are the same product: every word of the item first, then most shops, then cheapest. */
export function bestProduct(products: Product[], item: string): Product | null {
  const words = tokens(item);
  const exact = (p: Product) => (words.every((w) => tokens(p.title).includes(w)) ? 0 : 1);
  const cheapest = (p: Product) => Math.min(...p.offers.map((o) => o.price));
  return (
    products
      .filter((p) => p.offers.length > 0 && sameProduct(item, p.title))
      .sort((a, b) => exact(a) - exact(b) || b.offers.length - a.offers.length || cheapest(a) - cheapest(b))[0] ?? null
  );
}

// ---------- price tracking (docs/channel3/api-reference_price-tracking_*.md, shapes confirmed live 2026-10-11) ----------
// Channel3 charges 1 credit per tracked product per day, so callers cap how many watches run (src/core/watch.ts).

/** Canonical product ids look like "VpRxZ86". Anything else never reaches a URL or a body. */
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Answer = { status: number; body: unknown } | null;

/** One call to Channel3: null when it can't be reached (no key, network error, timeout). Logs status codes, never the key. */
async function c3(method: "GET" | "POST", path: string, body?: unknown): Promise<Answer> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) {
    console.error(`[spotter] CHANNEL3_API_KEY is not set, so Channel3 ${method} ${path.split("?")[0]} was skipped`);
    return null;
  }
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { "x-api-key": key, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) console.error(`[spotter] Channel3 ${method} ${path.split("?")[0]} answered ${r.status}`);
    const answer = await r.json().catch(() => null);
    if (r.ok && answer === null) {
      console.error(`[spotter] Channel3 ${method} ${path.split("?")[0]} answered ${r.status} with a body that isn't JSON`);
      return null;
    }
    return { status: r.status, body: answer };
  } catch (e) {
    console.error(`[spotter] Channel3 ${method} ${path.split("?")[0]} error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Subscribes to a product's price changes. "not_found" when Channel3 has no such product; null on an outage or no credits. */
export async function startTracking(productId: string): Promise<"active" | "not_found" | null> {
  if (!PRODUCT_ID.test(productId)) return "not_found";
  const a = await c3("POST", "/v0/price-tracking/start", { canonical_product_id: productId });
  if (!a) return null;
  if (a.status === 404) return "not_found";
  if (a.status !== 200) return null;
  return (a.body as { subscription_status?: string } | null)?.subscription_status === "active" ? "active" : null;
}

/** Unsubscribes. True when nothing is tracked any more (a 404 means it already wasn't); null on an outage, to retry later. */
export async function stopTracking(productId: string): Promise<true | null> {
  if (!PRODUCT_ID.test(productId)) return true;
  const a = await c3("POST", "/v0/price-tracking/stop", { canonical_product_id: productId });
  if (!a) return null;
  return a.status === 200 || a.status === 404 ? true : null;
}

export type PricePoint = { at: string; price: number; currency: string };
export type PriceHistory = { title: string | null; points: PricePoint[]; current: { price: number; currency: string; status: "low" | "typical" | "high" } | null };

const minor = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : null);

/** Up to 30 days of a product's price history. An empty history is data; null means Channel3 couldn't be reached. */
export async function priceHistory(productId: string, days = 30): Promise<PriceHistory | null> {
  if (!PRODUCT_ID.test(productId)) return { title: null, points: [], current: null };
  const a = await c3("GET", `/v0/price-tracking/history/${productId}?days=${Math.min(30, Math.max(1, Math.round(days)))}`);
  if (!a || a.status !== 200) return null;
  const b = (a.body ?? {}) as {
    product_title?: string | null;
    history?: Array<{ timestamp?: string; price?: number; currency?: string }>;
    statistics?: { current_price?: number; current_status?: string; currency?: string } | null;
  };
  const points = (b.history ?? []).flatMap((p) => {
    const price = minor(p.price);
    return typeof p.timestamp === "string" && price !== null && price > 0 && typeof p.currency === "string" ? [{ at: p.timestamp, price, currency: p.currency }] : [];
  });
  const s = b.statistics;
  const cur = minor(s?.current_price);
  const status = s?.current_status === "low" || s?.current_status === "high" ? s.current_status : "typical";
  return {
    title: typeof b.product_title === "string" ? b.product_title : null,
    points,
    current: s && cur !== null && typeof s.currency === "string" ? { price: cur, currency: s.currency, status } : null,
  };
}

/** One product's current offers in the family's currency, from the product endpoint (free). Null on an outage. */
export async function productOffers(productId: string, currency: Currency): Promise<Product | null> {
  if (!PRODUCT_ID.test(productId)) return null;
  const a = await c3("GET", `/v1/products/${productId}?country=${COUNTRY[currency]}&currency=${currency}`);
  if (!a || a.status !== 200 || !a.body) return null;
  const p = a.body as C3Product;
  if (typeof p.id !== "string" || typeof p.title !== "string") return null;
  return { id: p.id, title: p.title, brand: p.brands?.[0]?.name, image: p.images?.[0]?.url, offers: toOffers(p, currency) };
}
