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
import { claimsUsed, genuineOffers, likeUsed, likeUsedText, onePerShop, type LikeUsed, type MarketSummary, type Offer } from "@/core/market";
import { formatMoney, type Currency } from "@/core/types";
import { sameProduct, sellsTo, type ImageQuery, type PriceHigh, type Product } from "./channel3";
import { plausibleOffers } from "./sanity";

export type SpotDifference = { label: "Price" | "Condition" | "Was price" | "Web address" | "Seller"; here: string; real: string };

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
  /** Set when the item, sold as new, is priced below every new offer but inside the used range. */
  likeUsed?: LikeUsed;
  /**
   * "market": built from the payment's saved going rate (the same numbers as the reasons line and Activity), no image
   * search. "image": from a Channel3 image search, when the payment had no going rate. Older rows have neither: image.
   */
  source?: "market" | "image";
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
  /** The payment's saved going rate (marketSummary). When it has a cheapest shop, the panel is built from it. */
  market?: MarketSummary | null;
};

const SHOP_REASONS = new Set(["fake shop price", "brand new shop", "hidden instructions"]);
const MAX_IMAGE_BYTES = 1_500_000;
const HISTORY_MS = 2_500;
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
  const m = new RegExp(`${sign}\\s?(\\d{1,3}(?:,\\d{3})+|\\d{1,7})(?:\\.(\\d{2}))?(?![\\d,])`).exec(text);
  if (!m) return null;
  const minor = Number(m[1]!.replace(/,/g, "")) * 100 + Number(m[2] ?? 0);
  return minor > 0 ? minor : null;
}

/** The picture to search with: our own screenshot (a JPEG or PNG data URL, not too big), else a public https image link. */
function pictureOf(page: SpotInput["page"]): { query: ImageQuery; key: string } | null {
  if (page.screenshot) {
    const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(page.screenshot);
    const bytes = m ? Buffer.from(m[2]!, "base64") : Buffer.alloc(0);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (m && (jpeg || png) && bytes.length <= MAX_IMAGE_BYTES) {
      return { query: { base64: m[2]! }, key: createHash("sha256").update(bytes).digest("hex") };
    }
    console.error(`[spotter] spot the difference: the screenshot isn't a JPEG or PNG under ${MAX_IMAGE_BYTES} bytes, so it isn't sent`);
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
  const [used] = await deps.db.query<{ total: string; mine: string }>(
    `select (select count(*) from image_checks where at > now() - interval '1 day') as total,
            (select count(*) from image_checks where household_id = $1 and at > now() - interval '1 day') as mine`,
    [deps.householdId],
  );
  if (Number(used?.total ?? 0) >= (deps.overall ?? 200) || Number(used?.mine ?? 0) >= (deps.perHousehold ?? 10)) {
    console.error(`[spotter] spot the difference skipped for ${deps.householdId}: daily image search cap reached`);
    return null;
  }
  const products = await deps.imageSearch(pic.query, currency);
  if (!products) {
    console.error("[spotter] spot the difference: Channel3 image search gave no answer, so nothing is shown");
    return null; // an outage is never cached as "no match", and costs the family no slot
  }
  // Counted once Channel3 answered (count then insert isn't atomic; a race can go one or two over, which is fine here).
  await deps.db.query("insert into image_checks (household_id) values ($1)", [deps.householdId]);
  try {
    await deps.db.query(
      "insert into image_search_cache (key, products) values ($1, $2) on conflict (key) do update set products = excluded.products, fetched_at = now()",
      [key, JSON.stringify(products)],
    );
  } catch (e) {
    console.error("[spotter] caching the image search failed (the result is still used):", e instanceof Error ? e.message : e);
  }
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
  // One going rate per card: when the payment check already found one, the panel shows that, not a second search.
  const saved = input.market;
  if (saved?.cheapest) return fromMarket(input, saved.median, saved.offers, saved.cheapest);
  const pic = pictureOf(input.page);
  if (!pic) {
    if (input.page.productImage) console.error("[spotter] spot the difference: the page's product picture isn't a public https link, so it isn't sent");
    return null;
  }
  const products = await search(deps, pic, input.currency);
  if (!products?.length) return null;

  const shopHost = host(input.page.finalUrl);
  const payee = input.payee.trim().toLowerCase();
  type Listing = Offer & { productId: string; image?: string };
  const matched: Listing[] = products
    .filter((p) => sameItem(item, p))
    .flatMap((p) =>
      p.offers.map((o) => ({ ...o, domain: o.domain.toLowerCase().replace(/^www\./, ""), productId: p.id, ...(p.image && CDN_IMAGE.test(p.image) ? { image: p.image } : {}) })),
    )
    .filter(
      (o) =>
        o.currency === input.currency && o.price > 0 && DOMAIN.test(o.domain) && sellsTo(o.domain, input.currency) && o.domain !== shopHost && o.domain !== payee && BUY_URL.test(o.url),
    );
  // The going rate and the shop to show come from genuine new listings (and ones whose condition isn't known), one
  // price per shop, the same rule as the payment check; used ones only count for "priced like a used one".
  // Fashion shops, designer brands the item doesn't name and a premium tail never set the going rate (sanity.ts).
  const plausible = plausibleOffers(matched, item) as Listing[];
  const real = new Set<Offer>(genuineOffers(plausible, input.currency));
  const listings = plausible.filter((o) => real.has(o));
  if (!listings.length) return null;
  const lu = claimsUsed(item) ? null : likeUsed(input.amount, input.currency, plausible);

  const typical = median(onePerShop(listings).map((o) => o.price));
  const cheapest = listings.reduce((a, b) => (b.price < a.price ? b : a));
  // The safer option the agent was already told about, when it is the same product at one of these retailers.
  const safer = (
    await deps.db.query<{ id: string; offer: Offer }>("select id, offer from safer_options where payment_id = $1 order by created_at desc limit 1", [input.paymentId])
  )[0];
  // Reused only when it is the same live listing (same shop, same price), so the panel shows only live numbers.
  const reuse =
    safer &&
    listings.find((l) => l.domain === safer.offer.domain && l.price === safer.offer.price && safer.offer.currency === input.currency && sameItem(item, { title: safer.offer.title }));
  const pick: Listing & { offerId?: string } = reuse ? { ...reuse, offerId: safer.id } : cheapest;

  const money = (minor: number) => formatMoney({ amount: minor, currency: input.currency });
  const shops = new Set(listings.map((l) => l.domain));
  // The headline, the price row and the verdict all compare with the one listing the panel shows, so none of them
  // can put a middle price next to a different listing. typical and offers still say what the going rate came from.
  const { headline, direction, verdict } = compare(input.amount, pick.price, pick.domain, money);

  const differences: SpotDifference[] = [];
  if (direction !== "similar") differences.push({ label: "Price", here: money(input.amount), real: money(pick.price) });
  if (lu) differences.push({ label: "Condition", here: `Sold as new for ${money(input.amount)}`, real: likeUsedText(lu, input.currency) });
  const wasHere = parseWas(input.page.was, input.currency);
  if (wasHere && deps.priceHigh) {
    // Optional, so it gets a short limit of its own: a slow history call drops this row, never the whole comparison.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const high = await Promise.race([
      deps.priceHigh(pick.productId),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${HISTORY_MS} ms`)), HISTORY_MS))),
    ])
      .catch((e) => {
        console.error(`[spotter] price history for ${pick.productId} failed (the was price isn't checked):`, e instanceof Error ? e.message : e);
        return null;
      })
      .finally(() => clearTimeout(timer));
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
    ...(lu ? { likeUsed: lu } : {}),
    offers: shops.size,
    currency: input.currency,
    here: { host: shopHost, price: input.amount, payee: payeeName },
    genuine: { title: plain(pick.title), domain: pick.domain, price: pick.price, url: pick.url, ...(pick.image ? { image: pick.image } : {}), ...(pick.offerId ? { offerId: pick.offerId } : {}) },
    source: "image",
    at: new Date().toISOString(),
  };
}

/** One number, the direction and the verdict line, all against the one listing the panel shows. */
function compare(amount: number, listed: number, domain: string, money: (minor: number) => string) {
  const ratio = amount / listed;
  const direction: SpotTheDifference["direction"] = ratio < 0.85 ? "cheaper" : ratio > 1.15 ? "dearer" : "similar";
  return {
    headline: `${money(amount)} here, ${money(listed)} at ${domain}`,
    direction,
    verdict: direction === "cheaper" ? (ratio < 0.4 ? VERDICT.far : VERDICT.cheaper) : VERDICT[direction],
  };
}

/** The panel from the payment's saved going rate: the same shop count and cheapest shop as the card. */
function fromMarket(input: SpotInput, typical: number, offers: number, c: Offer): SpotTheDifference {
  const money = (minor: number) => formatMoney({ amount: minor, currency: input.currency });
  const domain = c.domain.toLowerCase().replace(/^www\./, "");
  const shopHost = host(input.page.finalUrl);
  const { headline, direction, verdict } = compare(input.amount, c.price, domain, money);
  const differences: SpotDifference[] = [];
  if (direction !== "similar") differences.push({ label: "Price", here: money(input.amount), real: money(c.price) });
  if (shopHost && shopHost !== domain) differences.push({ label: "Web address", here: shopHost, real: domain });
  const payeeName = plain(input.payee, 60);
  const payee = input.payee.trim().toLowerCase();
  if (payeeName && payee !== shopHost && payee !== domain) differences.push({ label: "Seller", here: payeeName, real: domain });
  return {
    headline,
    verdict,
    direction,
    differences: differences.slice(0, 3),
    typical,
    offers,
    currency: input.currency,
    here: { host: shopHost, price: input.amount, payee: payeeName },
    genuine: {
      title: plain(c.title),
      domain,
      price: c.price,
      url: BUY_URL.test(c.url) ? c.url : "",
      ...(c.image && CDN_IMAGE.test(c.image) ? { image: c.image } : {}),
    },
    source: "market",
    at: new Date().toISOString(),
  };
}
