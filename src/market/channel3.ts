// Channel3 product search: real retailer offers for an item, used as price evidence and for agent shopping.
// Docs: docs/channel3/ (https://docs.trychannel3.com). Cached in Postgres so repeat checks cost no credits.
import type { Db } from "@/db";
import { genuineOffers, type Offer } from "@/core/market";
import type { Currency } from "@/core/types";
import { plausibleOffers } from "./sanity";

const BASE = "https://api.trychannel3.com";
const TIMEOUT_MS = 8_000;
const CACHE_DAYS = 7;

type C3Offer = { url: string; domain: string; price?: { price: number; currency: string } | null; availability?: string; condition?: string | null };
type C3Product = {
  id: string;
  title: string;
  brands?: Array<{ name: string }>;
  offers?: C3Offer[];
  images?: Array<{ url: string }>;
  category?: { slug?: unknown; path?: Array<{ slug?: unknown }> } | null;
};

/**
 * categories: the product's category slug, then the slugs on its path (Channel3 category model). department: the
 * second level of that path ("kitchen-dining", "electronics" under a broad root), used to drop wrong kind matches.
 */
export type Product = { id: string; title: string; brand?: string; image?: string; offers: Offer[]; categories?: string[]; department?: string };

/** Channel3's offer conditions filter: "refurbished" was retired as a filter value (it is rejected). */
export type Condition = "new" | "used";

const COUNTRY: Record<Currency, string> = { GBP: "GB", USD: "US" };

/** Country endings used by shops everywhere (.co, .io ...), so they say nothing about where a shop sells. */
const GENERIC_CC = new Set(["co", "io", "ai", "me", "tv", "gg", "ly", "so", "fm", "to", "cc"]);
const HOME_CC: Record<Currency, string[]> = { GBP: ["uk"], USD: ["us"] };

/**
 * Could this shop sell to a payer in this currency's country? Channel3 sometimes lists another country's shop with a
 * converted price (lecreuset.com.au in pounds): a web address ending in another country's code is left out of every
 * going rate. .com and other non country endings stay.
 */
export function sellsTo(domain: string, currency: Currency): boolean {
  const tld = domain.toLowerCase().replace(/\.$/, "").split(".").pop() ?? "";
  if (tld.length !== 2 || GENERIC_CC.has(tld)) return true;
  return HOME_CC[currency].includes(tld);
}

// The product's own picture on Channel3's image server, the only kind of picture link ever kept.
const CDN_IMAGE = /^https:\/\/cdn\.trychannel3\.com\/[A-Za-z0-9._~%?=&/-]{1,300}$/;

function toOffers(p: C3Product, currency: Currency): Offer[] {
  const image = p.images?.[0]?.url;
  return (p.offers ?? [])
    .filter((o) => o.price && o.price.currency === currency && o.availability !== "OutOfStock" && typeof o.domain === "string" && sellsTo(o.domain, currency))
    .map((o) => ({
      title: p.title,
      brand: p.brands?.[0]?.name,
      domain: o.domain,
      price: Math.round(o.price!.price * 100),
      currency,
      url: o.url,
      // Left out when the shop doesn't say (null, or a value this code doesn't know): unknown counts as not used.
      ...(o.condition === "new" || o.condition === "used" ? { condition: o.condition } : {}),
      ...(image && CDN_IMAGE.test(image) ? { image } : {}),
    }));
}

const SLUG = /^[a-z0-9-]{1,80}$/;
function categoriesOf(p: C3Product): string[] | undefined {
  const c = p.category;
  if (!c || typeof c !== "object") return undefined;
  const slugs = [c.slug, ...(Array.isArray(c.path) ? c.path.map((x) => x?.slug) : [])].filter((s): s is string => typeof s === "string" && SLUG.test(s));
  return slugs.length ? [...new Set(slugs)] : undefined;
}

function departmentOf(p: C3Product): string | undefined {
  const path = Array.isArray(p.category?.path) ? p.category.path.map((x) => x?.slug).filter((s): s is string => typeof s === "string" && SLUG.test(s)) : [];
  return path[1] ?? path[0];
}

function toProduct(p: C3Product, currency: Currency): Product {
  const categories = categoriesOf(p);
  const department = departmentOf(p);
  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name,
    image: p.images?.[0]?.url,
    offers: toOffers(p, currency),
    ...(categories ? { categories } : {}),
    ...(department ? { department } : {}),
  };
}

/**
 * Raw search. Returns null (not []) when Channel3 can't be reached, so callers never mistake an outage for "no offers".
 * conditions: Channel3's offer condition filter; left out, Channel3 uses ["new"] (which also matches unknown).
 */
export async function searchProducts(query: string, currency: Currency, limit = 8, conditions?: Condition[]): Promise<Product[] | null> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}/v1/search`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 200), limit, ...(conditions ? { filters: { conditions } } : {}), config: { country: COUNTRY[currency], currency } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`[spotter] Channel3 search failed: ${r.status}`);
      return null;
    }
    const j = (await r.json()) as { products?: C3Product[] };
    return (j.products ?? []).map((p) => toProduct(p, currency));
  } catch (e) {
    console.error("[spotter] Channel3 search error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type ImageQuery = { base64: string } | { url: string };

/**
 * Image search (POST /v1/image-search, 1 credit): products that look like the picture, with segment "AUTO" so Channel3
 * crops the main product out of a page screenshot first. Same product shape as text search. null when Channel3 can't
 * be reached or answers with an error, so an outage is never mistaken for "no match".
 */
export async function searchByImage(img: ImageQuery, currency: Currency, limit = 10, conditions?: Condition[]): Promise<Product[] | null> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}/v1/image-search`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        ...("base64" in img ? { base64_image: img.base64 } : { image_url: img.url }),
        limit,
        segment: "AUTO",
        ...(conditions ? { filters: { conditions } } : {}),
        config: { country: COUNTRY[currency], currency },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`[spotter] Channel3 image search failed: ${r.status}`);
      return null;
    }
    const j = (await r.json()) as { products?: unknown };
    if (!Array.isArray(j.products)) {
      console.error("[spotter] Channel3 image search answered without a product list");
      return null;
    }
    return (j.products as C3Product[]).filter((p) => p && typeof p.id === "string" && typeof p.title === "string").map((p) => toProduct(p, currency));
  } catch (e) {
    console.error("[spotter] Channel3 image search error:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------- find products in an image (POST /experimental/find-products-in-image, docs/channel3/api-reference_v1_find-products-in-image.md) ----------
// Alpha at Channel3. 1 credit plus 1 per detected thing. Live on 2026-10-11 it took about 3 to 13 seconds.

/** bbox: [x1, y1, x2, y2] in pixels of size, or null when Channel3 gave no usable box. */
export type SceneThing = { thing: string; bbox: [number, number, number, number] | null; categories: string[]; matches: Product[] };
/** size: [width, height] of the picture the boxes belong to; null for the whole photo fallback. */
export type Scene = { size: [number, number] | null; things: SceneThing[]; fallback?: boolean };

const SCENE_TIMEOUT_MS = 25_000;
export const MAX_THINGS = 6;

const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** The live answer as a Scene, or null when it isn't one. Never trusts a box that falls outside the picture. */
export function parseScene(j: unknown, currency: Currency): Scene | null {
  const b = j as { things?: unknown; image_size?: unknown } | null;
  if (!b || !Array.isArray(b.things)) return null;
  const sz = b.image_size;
  const size: [number, number] | null = Array.isArray(sz) && sz.length === 2 && whole(sz[0]) && whole(sz[1]) && sz[0] > 0 && sz[1] > 0 ? [sz[0], sz[1]] : null;
  const things: SceneThing[] = [];
  for (const raw of b.things.slice(0, MAX_THINGS)) {
    const t = raw as { thing?: unknown; bbox?: unknown; category_ids?: unknown; matches?: unknown } | null;
    if (!t || typeof t.thing !== "string") continue;
    const bb = Array.isArray(t.bbox) && t.bbox.length === 4 && t.bbox.every(whole) ? (t.bbox as [number, number, number, number]) : null;
    const bbox = size && bb && bb[2] > bb[0] && bb[3] > bb[1] && bb[2] <= size[0] && bb[3] <= size[1] ? bb : null;
    const categories = Array.isArray(t.category_ids) ? t.category_ids.filter((c): c is string => typeof c === "string" && SLUG.test(c)) : [];
    const matches = Array.isArray(t.matches)
      ? (t.matches as C3Product[]).filter((p) => p && typeof p.id === "string" && typeof p.title === "string").map((p) => toProduct(p, currency))
      : [];
    things.push({ thing: t.thing.slice(0, 80), bbox, categories, matches });
  }
  return { size, things };
}

/** Every product Channel3 finds in a photo, grouped by thing. null on any failure, so the caller can fall back. */
export async function findProductsInImage(base64: string, currency: Currency, condition: Condition, maxThings = MAX_THINGS): Promise<Scene | null> {
  const a = await c3(
    "POST",
    "/experimental/find-products-in-image",
    { base64_image: base64, max_things: Math.min(MAX_THINGS, Math.max(1, maxThings)), limit: 10, filters: { conditions: [condition] }, config: { country: COUNTRY[currency], currency } },
    SCENE_TIMEOUT_MS,
  );
  if (!a || a.status !== 200) return null;
  const s = parseScene(a.body, currency);
  if (!s) console.error("[spotter] Channel3 find products in image answered 200 without a list of things");
  return s;
}

/** Highest price over the last 30 days, in minor units of that currency. */
export type PriceHigh = { max: number; currency: string; days: number };

/**
 * GET /v0/price-tracking/history/{id}?days=30 without starting tracking (live on 2026-10-11 it answered with up to 30
 * days of history for some products and an empty list for others). The highest price seen, only when there is history;
 * the currency is whatever Channel3 recorded (often USD for a UK product), so callers check it. null otherwise.
 */
export async function priceHigh(productId: string): Promise<PriceHigh | null> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key || !/^[A-Za-z0-9_-]{1,64}$/.test(productId)) return null;
  try {
    const r = await fetch(`${BASE}/v0/price-tracking/history/${productId}?days=30`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`[spotter] Channel3 price history failed: ${r.status}`);
      return null;
    }
    return highFrom(await r.json());
  } catch (e) {
    console.error("[spotter] Channel3 price history error:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** The highest price in a history answer, when every point is in one currency. */
export function highFrom(j: unknown): PriceHigh | null {
  const h = (j as { history?: unknown })?.history;
  if (!Array.isArray(h) || !h.length) return null;
  const points = h.filter((p): p is { price: number; currency: string } => !!p && typeof p.price === "number" && p.price > 0 && typeof p.currency === "string");
  if (points.length !== h.length) return null;
  const currencies = new Set(points.map((p) => p.currency));
  if (currencies.size !== 1) return null;
  return { max: Math.round(Math.max(...points.map((p) => p.price)) * 100), currency: points[0]!.currency, days: points.length };
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

/**
 * When most matching products sit in one department (kitchen, electronics), a match from another one is a different
 * kind of thing with the same words in its title (earbuds charms at a fashion shop): it is left out. Products Channel3
 * didn't categorise stay.
 */
function sameKind(products: Product[]): Product[] {
  const known = products.filter((p) => p.department);
  const count = new Map<string, number>();
  for (const p of known) count.set(p.department!, (count.get(p.department!) ?? 0) + 1);
  const [top, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!top || !n || n * 2 <= known.length) return products;
  return products.filter((p) => !p.department || p.department === top);
}

/**
 * Offers pooled from every listing of the same product. Empty when nothing matches: no guess is better than a wrong one.
 * A new listing far below the going rate of the others (another product, a part, a fake listing) is left out, so the
 * payment check and the case agent's "real shops" never start from different cheapest prices. Used ones stay.
 */
export function offersFor(products: Product[], item: string): Offer[] {
  const matched = sameKind(products.filter((p) => sameProduct(item, p.title)));
  // Checked here too, for products cached before toOffers left other countries' shops out.
  // Fashion shops, designer brands the item doesn't name, and a premium tail are left out (src/market/sanity.ts).
  const all = plausibleOffers(
    matched.flatMap((p) => p.offers).filter((o) => sellsTo(o.domain, o.currency)),
    item,
  );
  const real = new Set([...new Set(all.map((o) => o.currency))].flatMap((c) => genuineOffers(all, c)));
  return all.filter((o) => o.condition === "used" || real.has(o));
}

/** Cached lookup used by the payment check. */
export function makeMarket(db: Db) {
  return async (item: string, currency: Currency): Promise<Offer[] | null> => {
    // "c5": fashion shops, designer brands and a premium tail are left out too (c4: other countries and departments,
    // c3: far below listings, c2: condition), so older rows aren't reused.
    const key = `c5:${currency}:${item.trim().toLowerCase()}`;
    const hit = await db.query<{ offers: Offer[] }>(
      `select offers from market_cache where key = $1 and fetched_at > now() - interval '${CACHE_DAYS} days'`,
      [key],
    );
    if (hit[0]) return hit[0].offers;
    const products = await searchProducts(item, currency, 8, ["new", "used"]);
    if (!products) return null;
    const offers = offersFor(products, item);
    await db.query(
      "insert into market_cache (key, offers) values ($1, $2) on conflict (key) do update set offers = excluded.offers, fetched_at = now()",
      [key, JSON.stringify(offers)],
    );
    return offers;
  };
}

export type SearchFn = (query: string, currency: Currency, limit: number) => Promise<Product[] | null>;

const SEARCH_CACHE_HOURS = 24;
const searchCap = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * A Channel3 search on a family's behalf (1 credit each), for price watches and agents' find_products. The same
 * words within a day come from the cache and cost nothing. Otherwise a slot is taken first, per family and overall
 * per day in one statement (like price_checks), and it counts even when the search finds nothing or fails.
 * "capped" when the day's slots are used up; null when Channel3 can't be reached.
 */
export async function familySearch(db: Db, householdId: string, search: SearchFn, query: string, currency: Currency, limit: number): Promise<Product[] | null | "capped"> {
  const key = `products:${currency}:${limit}:${query.trim().toLowerCase()}`;
  const hit = await db.query<{ offers: Product[] }>(
    `select offers from market_cache where key = $1 and fetched_at > now() - interval '${SEARCH_CACHE_HOURS} hours'`,
    [key],
  );
  if (hit[0]) return hit[0].offers;
  const took = await db.query(
    `insert into channel3_searches (household_id) select $1
     where (select count(*) from channel3_searches where at > now() - interval '1 day') < $2
       and (select count(*) from channel3_searches where household_id = $1 and at > now() - interval '1 day') < $3
     returning 1`,
    [householdId, searchCap("CHANNEL3_SEARCHES_PER_DAY", 300), searchCap("CHANNEL3_SEARCHES_PER_FAMILY", 10)],
  );
  if (!took.length) return "capped";
  const products = await search(query, currency, limit);
  if (!products) return null;
  // Products share the payment check's cache table under their own key prefix (its keys start with the currency).
  // The credit is spent either way, so a failed cache write is logged and the results are still used.
  await db
    .query("insert into market_cache (key, offers) values ($1, $2) on conflict (key) do update set offers = excluded.offers, fetched_at = now()", [key, JSON.stringify(products)])
    .catch((e: unknown) => console.error("[spotter] caching a Channel3 search failed; the next ask searches again:", e instanceof Error ? e.message : e));
  return products;
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
async function c3(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<Answer> {
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
      signal: AbortSignal.timeout(timeoutMs),
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
