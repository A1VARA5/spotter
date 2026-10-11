// "Spot the difference". When Spotter holds a payment for a shop reason (a fake shop price, a brand new shop, hidden
// instructions), it sends KERNEL's screenshot of the shop page (or the page's product image link) to Channel3's image
// search to find the genuine product at real retailers, and shows the two side by side: one number, one verdict line
// and up to 3 differences. Rules that keep it honest:
// - A result is only used when it is the same product as the item being paid for (every word of the item, the brand
//   may stand in for one), so a picture built to mislead the search, or a look-alike, shows nothing rather than a
//   wrong match. No match, an outage or a bad picture all mean: show nothing, never a guess.
// - Retailer names and prices come only from Channel3's live answer, never from the shop page.
// - Searches are cached by a hash of the picture and capped per family per day (image_checks, like price_checks).
import { createHash } from "node:crypto";
import type { Db } from "@/db";
import type { Offer } from "@/core/market";
import { formatMoney, type Currency } from "@/core/types";
import { sameProduct, type ImageQuery, type PriceHigh, type Product } from "./channel3";

export type SpotDifference = { label: "Price" | "Was price" | "Web address" | "Seller"; here: string; real: string };

export type SpotTheDifference = {
  /** "£19.99 here, about £49.99 at real shops" */
  headline: string;
  verdict: string;
  direction: "cheaper" | "dearer" | "similar";
  differences: SpotDifference[];
  /** The middle price of every matching listing, in minor units. */
  typical: number;
  /** How many matching listings that is. */
  offers: number;
  currency: Currency;
  here: { host: string; price: number; payee: string };
  genuine: { title: string; domain: string; price: number; url: string; image?: string; offerId?: string };
  at: string;
};

export type SpotDeps = {
  db: Db;
  householdId: string;
  imageSearch: (img: ImageQuery, currency: Currency) => Promise<Product[] | null>;
  /** Highest price over the last 30 days for a product id (Channel3 price history). Optional. */
  priceHigh?: (productId: string) => Promise<PriceHigh | null>;
  perHousehold?: number;
  overall?: number;
};

export type SpotInput = {
  paymentId: string;
  item?: string;
  amount: number;
  currency: Currency;
  payee: string;
  /** Why the payment was held or stopped; only shop reasons get a comparison. */
  reason: string | null;
  page: { finalUrl: string; screenshot?: string; productImage?: string; was?: string };
};

const SHOP_REASONS = new Set(["fake shop price", "brand new shop", "hidden instructions"]);
const MAX_IMAGE_BYTES = 1_500_000;
const CACHE_DAYS = 7;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const CDN_IMAGE = /^https:\/\/cdn\.trychannel3\.com\/[A-Za-z0-9._~%?=&/-]{1,300}$/;
const BUY_URL = /^https:\/\/[a-z0-9.-]+\/[^\s"<>]{0,600}$/i;

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").replace(/\.$/, "").toLowerCase();
  } catch {
    return "";
  }
};
const plain = (s: string, max = 120) => [...s.replace(/[\u0000-\u001f\u007f<>"`]/g, " ").replace(/\s+/g, " ").trim()].slice(0, max).join("");

/**
 * Stricter than the price check's match: every word of the item must be in the listing (its brand counts), except that
 * an item of four or more words may miss one. sameProduct's model number and accessory rules apply too.
 */
export function sameItem(item: string, p: Pick<Product, "title" | "brand">): boolean {
  if (!sameProduct(item, p.title)) return false;
  const have = new Set([...tokens(p.title), ...tokens(p.brand ?? "")]);
  const words = tokens(item).filter((t) => !/\d/.test(t));
  const missing = words.filter((w) => !have.has(w)).length;
  return missing === 0 || (words.length >= 4 && missing <= 1);
}

/** A struck through "was" price from the page, in the payment's currency, in minor units. */
export function parseWas(text: string | undefined, currency: Currency): number | null {
  if (!text) return null;
  const sign = currency === "GBP" ? "£" : "\\$";
  const m = new RegExp(`${sign}\\s?(\\d{1,3}(?:,\\d{3})*|\\d{1,7})(?:\\.(\\d{2}))?`).exec(text);
  if (!m) return null;
  const minor = Number(m[1]!.replace(/,/g, "")) * 100 + Number(m[2] ?? 0);
  return minor > 0 ? minor : null;
}

/** The picture to search with: our own screenshot (a JPEG or PNG data URL, not too big), else a public https image link. */
function pictureOf(page: SpotInput["page"]): { query: ImageQuery; key: string } | null {
  if (page.screenshot) {
    const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(page.screenshot);
    if (!m) return null;
    const bytes = Buffer.from(m[2]!, "base64");
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!(jpeg || png) || bytes.length > MAX_IMAGE_BYTES) return null;
    return { query: { base64: m[2]! }, key: createHash("sha256").update(bytes).digest("hex") };
  }
  if (page.productImage) {
    let u: URL;
    try {
      u = new URL(page.productImage);
    } catch {
      return null;
    }
    const h = u.hostname.toLowerCase();
    const privateHost = /^(localhost|.*\.local|.*\.internal)$/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[");
    if (u.protocol !== "https:" || privateHost || !DOMAIN.test(h) || page.productImage.length > 2000) return null;
    return { query: { url: u.toString() }, key: createHash("sha256").update(`url:${u.toString()}`).digest("hex") };
  }
  return null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Cached image search: a hit costs nothing; a miss takes one of the family's daily slots first. null: show nothing. */
async function search(deps: SpotDeps, pic: { query: ImageQuery; key: string }, currency: Currency): Promise<Product[] | null> {
  const key = `${currency}:${pic.key}`;
  const hit = await deps.db.query<{ products: Product[] }>(
    `select products from image_search_cache where key = $1 and fetched_at > now() - interval '${CACHE_DAYS} days'`,
    [key],
  );
  if (hit[0]) return hit[0].products;
  const took = await deps.db.query(
    `insert into image_checks (household_id) select $1
     where (select count(*) from image_checks where at > now() - interval '1 day') < $2
       and (select count(*) from image_checks where household_id = $1 and at > now() - interval '1 day') < $3
     returning 1`,
    [deps.householdId, deps.overall ?? 200, deps.perHousehold ?? 10],
  );
  if (!took.length) {
    console.error(`[spotter] spot the difference skipped for ${deps.householdId}: daily image search cap reached`);
    return null;
  }
  const products = await deps.imageSearch(pic.query, currency);
  if (!products) return null; // an outage is never cached as "no match"
  await deps.db.query(
    "insert into image_search_cache (key, products) values ($1, $2) on conflict (key) do update set products = excluded.products, fetched_at = now()",
    [key, JSON.stringify(products)],
  );
  return products;
}

const VERDICT = {
  far: "Real shops charge far more for the same thing. Prices this low are a fake shop tell.",
  cheaper: "Real shops charge more for the same thing, so check who you're really paying.",
  dearer: "Real shops sell the same thing for less.",
  similar: "The price is normal, so the question is who you're paying.",
} as const;

/**
 * The comparison for the case file, or null (show nothing). Never throws: the case must still be filed.
 */
export async function spotTheDifference(deps: SpotDeps, input: SpotInput): Promise<SpotTheDifference | null> {
  try {
    return await build(deps, input);
  } catch (e) {
    console.error(`[spotter] spot the difference for ${input.paymentId} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function build(deps: SpotDeps, input: SpotInput): Promise<SpotTheDifference | null> {
  const item = input.item?.trim();
  if (!input.reason || !SHOP_REASONS.has(input.reason) || !item) return null;
  const pic = pictureOf(input.page);
  if (!pic) return null;
  const products = await search(deps, pic, input.currency);
  if (!products?.length) return null;

  const shopHost = host(input.page.finalUrl);
  const payee = input.payee.trim().toLowerCase();
  type Listing = Offer & { productId: string; image?: string };
  const listings: Listing[] = products
    .filter((p) => sameItem(item, p))
    .flatMap((p) =>
      p.offers.map((o) => ({ ...o, domain: o.domain.toLowerCase().replace(/^www\./, ""), productId: p.id, ...(p.image && CDN_IMAGE.test(p.image) ? { image: p.image } : {}) })),
    )
    .filter((o) => o.currency === input.currency && o.price > 0 && DOMAIN.test(o.domain) && o.domain !== shopHost && o.domain !== payee && BUY_URL.test(o.url));
  if (!listings.length) return null;

  const typical = median(listings.map((o) => o.price));
  const cheapest = listings.reduce((a, b) => (b.price < a.price ? b : a));
  // The safer option the agent was already told about, when it is the same product at one of these retailers.
  const safer = (
    await deps.db.query<{ id: string; offer: Offer }>("select id, offer from safer_options where payment_id = $1 order by created_at desc limit 1", [input.paymentId])
  )[0];
  const reuse = safer && listings.find((l) => l.domain === safer.offer.domain && sameItem(item, { title: safer.offer.title }) && safer.offer.currency === input.currency);
  const pick: Listing & { offerId?: string } = reuse ? { ...reuse, title: safer.offer.title, price: safer.offer.price, url: safer.offer.url, offerId: safer.id } : cheapest;

  const money = (minor: number) => formatMoney({ amount: minor, currency: input.currency });
  const ratio = input.amount / typical;
  const direction = ratio < 0.85 ? "cheaper" : ratio > 1.15 ? "dearer" : "similar";
  const shops = new Set(listings.map((l) => l.domain));
  const headline =
    shops.size > 1 ? `${money(input.amount)} here, about ${money(typical)} at real shops` : `${money(input.amount)} here, ${money(typical)} at ${pick.domain}`;
  const verdict = direction === "cheaper" ? (ratio < 0.4 ? VERDICT.far : VERDICT.cheaper) : VERDICT[direction];

  const differences: SpotDifference[] = [];
  if (direction !== "similar") differences.push({ label: "Price", here: money(input.amount), real: money(pick.price) });
  const wasHere = parseWas(input.page.was, input.currency);
  if (wasHere && deps.priceHigh) {
    const high = await deps.priceHigh(pick.productId).catch((e) => {
      console.error(`[spotter] price history for ${pick.productId} failed (the was price isn't checked):`, e instanceof Error ? e.message : e);
      return null;
    });
    // Only in the same currency, and only when the claim is far above anything real shops charged.
    if (high && high.currency === input.currency && wasHere > high.max * 1.5) {
      differences.push({ label: "Was price", here: `Says it was ${money(wasHere)}`, real: `No more than ${money(high.max)} at real shops in 30 days` });
    }
  }
  if (shopHost && shopHost !== pick.domain) differences.push({ label: "Web address", here: shopHost, real: pick.domain });
  const payeeName = plain(input.payee, 60);
  if (payeeName && payee !== shopHost && payee !== pick.domain) differences.push({ label: "Seller", here: payeeName, real: pick.domain });

  return {
    headline,
    verdict,
    direction,
    differences: differences.slice(0, 3),
    typical,
    offers: listings.length,
    currency: input.currency,
    here: { host: shopHost, price: input.amount, payee: payeeName },
    genuine: { title: plain(pick.title), domain: pick.domain, price: pick.price, url: pick.url, ...(pick.image ? { image: pick.image } : {}), ...(pick.offerId ? { offerId: pick.offerId } : {}) },
    at: new Date().toISOString(),
  };
}
