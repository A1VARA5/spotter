// Photo price check: one photo, every thing in it priced against real shops. For a doorstep quote, a "whole room set
// £49" ad, or the things someone wants to buy from Gran for "£40 the lot". Channel3 finds the things in the photo
// (POST /experimental/find-products-in-image) and Spotter prices each one, new offers when buying and used offers when
// selling. Rules that keep it honest:
// - A thing is only priced when at least two of Channel3's listings for it agree on the model (same brand, same model
//   number, no Pro/Max mix up) and the listing is the right kind of thing for the box. Otherwise it says "couldn't find
//   this one". No guess, ever.
// - Shop names, product names and prices come only from Channel3's live answer.
// - Nothing moves money, so no PIN; capped per family and per day (photo_checks), cached by a hash of the picture.
//   The picture itself is never stored: only Channel3's answer is cached.
import { createHash } from "node:crypto";
import type { Db } from "@/db";
import type { Offer } from "@/core/market";
import type { Currency } from "@/core/types";
import { plausibleOffers } from "./sanity";
import { MAX_THINGS, type Condition, type ImageQuery, type Product, type Scene, type SceneThing } from "./channel3";

export type PhotoMode = "buy" | "sell";

export type PhotoItem = {
  n: number;
  thing: string;
  bbox: [number, number, number, number] | null;
  /** How many of this kind of thing are in the photo, when more than one (each is priced the same). */
  count?: number;
  /** The boxes of the others of the same kind, shown with the same number. */
  more?: Array<[number, number, number, number]>;
} & (
  | { found: false }
  | {
      found: true;
      /**
       * "exact": the best matches agree on the model. "similar": an everyday thing with no model number (a sofa, a
       * lamp), priced from listings of the same kind of thing, and always said to be similar ones.
       */
      match: "exact" | "similar";
      title: string;
      image?: string;
      /** Lowest, highest and middle price of the matching offers, in minor units. For similar ones, the middle half of the listings. */
      low: number;
      high: number;
      typical: number;
      offers: number;
      shops: number;
      cheapest: { domain: string; price: number; url: string };
    }
);

export type PhotoResult = {
  mode: PhotoMode;
  currency: Currency;
  /** [width, height] the boxes belong to; null when there are no boxes (the whole photo fallback). */
  size: [number, number] | null;
  items: PhotoItem[];
  /** "Real shops: about £1,180 for these." */
  total: string;
  /** "They're asking £49 for all of it." or "They offered £40.", when an amount was given. */
  quote: string | null;
  verdict: string | null;
  /** Which way the verdict goes, so the page can label it without reading the sentence. */
  verdictKind?: "far_below" | "well_over" | "under_used" | null;
  quoted: number | null;
  fallback: boolean;
  at: string;
};

export type PhotoDeps = {
  db: Db;
  householdId: string;
  find: (base64: string, currency: Currency, condition: Condition) => Promise<Scene | null>;
  single: (img: ImageQuery, currency: Currency, conditions: Condition[]) => Promise<Product[] | null>;
  perHousehold?: number;
  overall?: number;
};

export type PhotoInput = { bytes: Buffer; mode: PhotoMode; currency: Currency; quoted: number | null };
export type PhotoAnswer = { ok: true; result: PhotoResult } | { ok: false; status: 400 | 429 | 502; error: string };

export const MAX_PHOTO_BYTES = 4_000_000;
const CACHE_DAYS = 7;
const WHOLE_PHOTO = "whole photo";
// How much agreement counts, from live answers on 2026-10-11: a laptop came back as a desktop PC whose two listings
// were Channel3's 1st and 4th match (wrong, so two far apart isn't enough), while real headphones came back as the
// 1st, 4th and 8th match (right). So: the model must be one of the best two matches, and either two of the best three
// listings are that model, or three of the best eight are.
const ANCHORS = 2;
const NEAR = 3;
const LOOK = 8;

// ---------- matching ----------

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hasLetter = (t: string) => /[a-z]/.test(t);
const hasDigit = (t: string) => /\d/.test(t);
/** A size, speed, storage or count, not a model: 34in, 360hz, 128gb, 2pack, 4k, 1440p. */
const SPEC = /^\d+(hz|khz|mhz|ghz|mm|cm|m|in|inch|gb|tb|mb|w|kw|mah|p|k|mp|v|kg|g|lb|oz|l|ml|x|pcs|pc|pack|st|nd|rd|th|ft|w)$/;
const UNIT_WORD = new Set(["inch", "in", "cm", "mm", "gb", "tb", "hz", "w", "pack", "pcs", "piece", "pieces", "x", "seater", "litre", "l", "ml", "kg"]);
const GENERIC = new Set([
  "monitor", "tv", "television", "laptop", "screen", "display", "oled", "qled", "led", "lcd", "hd", "uhd", "gaming", "size", "pack", "set", "series",
  "gen", "generation", "version", "model", "speaker", "speakers", "headphones", "with", "for", "and", "the", "of", "inch", "curved", "wireless", "piece",
]);
const VARIANTS = ["pro", "max", "plus", "mini", "ultra", "lite", "se", "air", "xl"];
const ACCESSORY = /\b(tips?|case|cases|cover|covers|strap|straps|charger|cable|replacement|protector|skin|stand|holder|refill|pads?|cushions?)\b/i;
/** An accessory listing, judged on the words before "with" ("headphones with mic/remote" or "earbuds with charging case" are the product). */
const accessory = (title: string) => ACCESSORY.test(title.split(/\bwith\b/i)[0] ?? title);

function modelParts(title: string) {
  const ts = tokens(title);
  const mixed = new Set(ts.filter((t) => t.length >= 2 && hasLetter(t) && hasDigit(t) && !SPEC.test(t)));
  const pairs = new Set<string>();
  ts.forEach((t, i) => {
    const next = ts[i + 1];
    if (next && /^[a-z]{3,}$/.test(t) && !GENERIC.has(t) && /^\d{1,4}$/.test(next) && !UNIT_WORD.has(ts[i + 2] ?? "")) pairs.add(`${t}${next}`);
  });
  const variants = VARIANTS.filter((v) => ts.includes(v)).join(",");
  return { mixed, pairs, variants };
}

/** Two listings are the same model: same brand, a shared model number, and no Pro or Max on one side only. */
export function sameModel(a: Pick<Product, "title" | "brand">, b: Pick<Product, "title" | "brand">): boolean {
  if (a.brand && b.brand && norm(a.brand) !== norm(b.brand)) return false;
  const x = modelParts(a.title);
  const y = modelParts(b.title);
  if (x.variants !== y.variants) return false;
  const sharedMixed = [...x.mixed].filter((t) => y.mixed.has(t));
  if (x.mixed.size && y.mixed.size && !sharedMixed.length) return false; // G8 and G9 are different models
  return sharedMixed.some((t) => t.length >= 3) || [...x.pairs].some((p) => y.pairs.has(p));
}

const stem = (w: string) => (/(ch|sh|s|x)es$/.test(w) ? w.slice(0, -2) : w.endsWith("s") ? w.slice(0, -1) : w);
const thingWords = (thing: string) =>
  tokens(thing.replace(/#\d+/g, " "))
    .filter((w) => w.length >= 3 && !hasDigit(w))
    .map(stem);

/** The listing is the kind of thing in the box: a category in common, or a word of the thing in its title. */
function rightKind(t: SceneThing, p: Product): boolean {
  if (t.thing === WHOLE_PHOTO) return true;
  if (t.categories.length && p.categories?.some((c) => t.categories.includes(c))) return true;
  const title = tokens(p.title);
  return thingWords(t.thing).some((w) => title.some((x) => x.startsWith(w)));
}

/** The listings of one confirmed model for this thing, best first, or null: never a guess. */
export function confirmMatch(t: SceneThing): Product[] | null {
  const wantsAccessory = ACCESSORY.test(t.thing);
  const cands = t.matches.slice(0, LOOK).filter((p) => wantsAccessory || !accessory(p.title));
  for (const anchor of cands.slice(0, ANCHORS)) {
    if (!rightKind(t, anchor)) continue;
    const group = cands.filter((p) => p === anchor || sameModel(anchor, p));
    const near = cands.slice(0, NEAR).filter((p) => group.includes(p)).length;
    if (near >= 2 || group.length >= 3) return group;
  }
  return null;
}

/** A listing title with a model number in it (G8, WH-1000XM4, iPhone 13): for these the exact model matters. */
const modelled = (title: string) => {
  const m = modelParts(title);
  return m.mixed.size > 0 || m.pairs.size > 0;
};
const SIMILAR_MIN = 3;

/**
 * For an everyday thing with no model number (a sofa, a floor lamp, curtains): the listings of the same kind among
 * Channel3's best eight, when the first or second match is that kind, there are at least three, and most of them have
 * no model number. Priced as "similar ones", never as the thing itself. Null otherwise.
 */
export function similarMatch(t: SceneThing): Product[] | null {
  if (t.thing === WHOLE_PHOTO) return null;
  const wantsAccessory = ACCESSORY.test(t.thing);
  const cands = t.matches.slice(0, LOOK).filter((p) => (wantsAccessory || !accessory(p.title)) && p.offers.length > 0);
  if (!cands.slice(0, ANCHORS).some((p) => rightKind(t, p))) return null;
  const kind = cands.filter((p) => rightKind(t, p));
  if (kind.length < SIMILAR_MIN) return null;
  if (kind.filter((p) => modelled(p.title)).length * 2 > kind.length) return null;
  return kind;
}

// ---------- the answer ----------

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const BUY_URL = /^https:\/\/[a-z0-9.-]+\/[^\s"<>]{0,600}$/i;
const CDN_IMAGE = /^https:\/\/cdn\.trychannel3\.com\/[A-Za-z0-9._~%?=&/-]{1,300}$/;
const plain = (s: string, max = 120) => [...s.replace(/[\u0000-\u001f\u007f<>"`]/g, " ").replace(/\s+/g, " ").trim()].slice(0, max).join("");

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** "£1,180": whole pounds, for "about" amounts. */
const about = (minor: number, currency: Currency) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(minor / 100));
/** "£49", or "£49.50" when there are pence. */
const exact = (minor: number, currency: Currency) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);

const label = (thing: string) => {
  if (thing === WHOLE_PHOTO) return "The whole photo";
  // Channel3 writes some things as one word ("overear headphones").
  const s = plain(thing.replace(/#\d+/g, "").replace(/\b(over|in|on)ear\b/gi, "$1 ear"), 60);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Something";
};

const wanted = (mode: PhotoMode) => (o: Offer) => (mode === "sell" ? o.condition === "used" : o.condition !== "used");

/** The usable offers of some listings: the right condition and currency, a real shop domain and link, no repeats. */
function usable(products: Product[], mode: PhotoMode, currency: Currency) {
  const seen = new Set<string>();
  return products
    .flatMap((p) => p.offers)
    .map((o) => ({ ...o, domain: o.domain.toLowerCase().replace(/^www\./, "") }))
    .filter((o) => wanted(mode)(o) && o.currency === currency && o.price > 0 && DOMAIN.test(o.domain) && BUY_URL.test(o.url))
    .filter((o) => !seen.has(o.url) && Boolean(seen.add(o.url)));
}

/** Nearest rank quartiles of sorted prices: the middle half, so one designer piece can't stretch the range. */
const quartiles = (sorted: number[]) => ({ low: sorted[Math.floor((sorted.length - 1) * 0.25)]!, high: sorted[Math.ceil((sorted.length - 1) * 0.75)]! });

function priceThing(t: SceneThing, n: number, mode: PhotoMode, currency: Currency): PhotoItem {
  const base = { n, thing: label(t.thing), bbox: t.bbox };
  const group = confirmMatch(t);
  if (group) {
    const offers = usable(group, mode, currency);
    // Two listings from one shop aren't two opinions (live: a designer lamp and its "Luxus" twin, both at one shop,
    // claimed an ordinary floor lamp). An exact price needs at least two shops; otherwise it is priced as similar.
    if (new Set(offers.map((o) => o.domain)).size >= 2) {
      const prices = offers.map((o) => o.price);
      const cheapest = offers.reduce((a, b) => (b.price < a.price ? b : a));
      const top = group[0]!;
      return {
        ...base,
        found: true,
        match: "exact",
        title: plain(top.title),
        ...(top.image && CDN_IMAGE.test(top.image) ? { image: top.image } : {}),
        low: Math.min(...prices),
        high: Math.max(...prices),
        typical: median(prices),
        offers: offers.length,
        shops: new Set(offers.map((o) => o.domain)).size,
        cheapest: { domain: cheapest.domain, price: cheapest.price, url: cheapest.url },
      };
    }
  }
  const similar = similarMatch(t);
  if (!similar) {
    // A confirmed model sold at one shop only, with no "similar ones" to fall back on: still the exact thing, from one shop.
    const one = group ? usable(group, mode, currency) : [];
    if (!group || !one.length) return { ...base, found: false };
    const top = group[0]!;
    const low = one.reduce((a, b) => (b.price < a.price ? b : a));
    const prices = one.map((o) => o.price);
    return {
      ...base,
      found: true,
      match: "exact",
      title: plain(top.title),
      ...(top.image && CDN_IMAGE.test(top.image) ? { image: top.image } : {}),
      low: Math.min(...prices),
      high: Math.max(...prices),
      typical: median(prices),
      offers: one.length,
      shops: 1,
      cheapest: { domain: low.domain, price: low.price, url: low.url },
    };
  }
  // One price per listing (its cheapest usable offer), so a listing sold by many shops doesn't outweigh the rest.
  const all = similar.flatMap((p) => {
    const o = usable([p], mode, currency);
    return o.length ? [{ p, o: o.reduce((a, b) => (b.price < a.price ? b : a)) }] : [];
  });
  // The market check's sanity (src/market/sanity.ts): fashion shops, designer brands and a premium tail above a big
  // price gap don't set the range for an everyday thing. Only used when enough listings are left to price it.
  const fair = new Set(plausibleOffers(all.map((e) => e.o), t.thing));
  const trimmed = all.filter((e) => fair.has(e.o));
  const each = trimmed.length >= SIMILAR_MIN ? trimmed : all;
  if (each.length < SIMILAR_MIN) return { ...base, found: false };
  const sorted = each.map((e) => e.o.price).sort((a, b) => a - b);
  const q = quartiles(sorted);
  // The example shop is the cheapest inside the range shown, never an odd one below it (live: a tree skirt among sheepskin rugs).
  const cheapest = each.filter((e) => e.o.price >= q.low).reduce((a, b) => (b.o.price < a.o.price ? b : a));
  return {
    ...base,
    found: true,
    match: "similar",
    title: plain(cheapest.p.title),
    ...(cheapest.p.image && CDN_IMAGE.test(cheapest.p.image) ? { image: cheapest.p.image } : {}),
    ...q,
    typical: median(sorted),
    offers: each.length,
    shops: new Set(each.map((e) => e.o.domain)).size,
    cheapest: { domain: cheapest.o.domain, price: cheapest.o.price, url: cheapest.o.url },
  };
}

const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

/** The numbered items and the one total line, from a scene. Pure, so the cached scene can be re-read with a new amount. */
export function buildPhoto(scene: Scene, mode: PhotoMode, currency: Currency, quoted: number | null): PhotoResult {
  // The same kind of thing twice (the two curtains of one window) is one row, counted, with every box it was found in.
  // Each thing is priced on its own first; only things with the same name AND the same result (both priced, or both
  // not found) share a row, so a match is never dropped or lent to one that wasn't found. "Something" never merges.
  const groups = new Map<string, PhotoItem[]>();
  scene.things.forEach((t, i) => {
    const item = priceThing(t, 0, mode, currency);
    const key = item.thing === "Something" ? `#${i}` : `${item.thing.toLowerCase()}|${item.found}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  const items: PhotoItem[] = [...groups.values()].map((g, i) => {
    const item = { ...g[0]!, n: i + 1 };
    if (g.length < 2) return item;
    const more = g.slice(1).flatMap((x) => (x.bbox ? [x.bbox] : []));
    return { ...item, count: g.length, ...(more.length ? { more } : {}) };
  });
  const count = (i: PhotoItem) => i.count ?? 1;
  const found = items.filter((i): i is Extract<PhotoItem, { found: true }> => i.found);
  const missing = items.filter((i) => !i.found).reduce((a, i) => a + count(i), 0);
  const sum = (f: (i: (typeof found)[number]) => number) => found.reduce((a, i) => a + f(i) * count(i), 0);
  const typical = sum((i) => i.typical);
  const low = sum((i) => i.low);
  const high = sum((i) => i.high);

  let total: string;
  if (scene.fallback && found.length) {
    // One search of the whole photo finds the main thing only, so it is never compared with a price for everything.
    const one = found[0]!;
    const amount = mode === "buy" ? `costs about ${about(one.typical, currency)} at real shops` : `sells used for about ${about(one.low, currency)}${one.low === one.high ? "" : ` to ${about(one.high, currency)}`}`;
    total = `Spotter could only search the photo as a whole. The closest match ${amount}. The other things in the photo weren't checked.`;
  } else if (!found.length) {
    total = "Spotter couldn't match any of these to real shop listings, so it can't say what they're worth.";
  } else {
    const amount = mode === "buy" ? `about ${about(typical, currency)}` : low === high || about(low, currency) === about(high, currency) ? `about ${about(low, currency)}` : `about ${about(low, currency)} to ${about(high, currency)}`;
    const allSimilar = found.every((i) => i.match === "similar");
    const lead = mode === "buy" ? `${allSimilar ? "Similar ones at real shops" : "Real shops"}: ${amount}` : `${allSimilar ? "Similar used ones" : "Used ones"} sell for ${amount}`;
    const note = allSimilar
      ? " These are similar things, not the exact ones in the photo."
      : found.some((i) => i.match === "similar")
        ? " Some are priced from similar things, not the exact ones."
        : "";
    total =
      (missing
        ? `${lead} for the ${things(found.reduce((a, i) => a + count(i), 0))} Spotter could match. It couldn't find the other ${missing}, so the real total is higher.`
        : mode === "buy"
          ? `${lead} for these.`
          : `${lead}.`) + note;
  }

  const quote = quoted === null ? null : mode === "buy" ? `They're asking ${exact(quoted, currency)} for all of it.` : `They offered ${exact(quoted, currency)}.`;
  let verdict: string | null = null;
  let verdictKind: PhotoResult["verdictKind"] = null;
  // Channel3 stops at MAX_THINGS, so a full list may still have left things out: no "well over" then.
  // Similar ones are a range of other makes, so "far below" is judged against the low end and "well over" never said.
  const exactOnly = found.every((i) => i.match === "exact");
  const complete = !missing && scene.things.length < MAX_THINGS && exactOnly;
  if (quoted !== null && found.length && !scene.fallback) {
    if (mode === "buy" && quoted < (exactOnly ? typical : low) * 0.4) {
      verdict = "That's far below what real shops charge. Deals this cheap are a common scam: never pay by bank transfer or Friends and Family.";
      verdictKind = "far_below";
    } else if (mode === "buy" && complete && quoted > typical * 1.3) {
      verdict = "That's well over what real shops charge for these.";
      verdictKind = "well_over";
    } else if (mode === "sell" && quoted < low * 0.6) {
      verdict = "That's well under what used ones sell for.";
      verdictKind = "under_used";
    }
  }
  return { mode, currency, size: scene.size, items, total, quote, verdict, verdictKind, quoted, fallback: Boolean(scene.fallback), at: new Date().toISOString() };
}

// ---------- input ----------

/** The picture, when it really is a JPEG, PNG or WEBP under the size limit. Never trusts a file name or a stated type. */
export function imageFrom(bytes: Buffer): { bytes: Buffer; type: "jpeg" | "png" | "webp" } | null {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, type: "jpeg" };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { bytes, type: "png" };
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { bytes, type: "webp" };
  return null;
}

/** The first amount in the family's currency ("£49", "1,250.50", or a bare number typed in the amount box), in minor units. */
export function parseAmount(text: string | undefined | null, currency: Currency): number | null {
  if (!text) return null;
  const other = currency === "GBP" ? /\$|usd/i : /£|gbp/i;
  const sign = currency === "GBP" ? "£" : "\\$";
  const m = new RegExp(`(?:${sign}\\s?)?(\\d{1,3}(?:,\\d{3})+|\\d{1,7})(?:\\.(\\d{1,2}))?`).exec(text);
  if (!m) return null;
  // A price marked in another currency is not this one.
  const before = text.slice(Math.max(0, m.index - 4), m.index + 1);
  if (other.test(before) && !new RegExp(sign).test(m[0])) return null;
  const minor = Number(m[1]!.replace(/,/g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return minor > 0 ? minor : null;
}

/**
 * The price in a caption, only when it is clearly the price: marked with the currency sign, or a bare number right
 * after "for", "asking", "offered" and the like, or the only number there is. "iPhone 15 and 2 cases" has no price.
 */
export function captionAmount(caption: string | undefined | null, currency: Currency): number | null {
  if (!caption) return null;
  const sign = currency === "GBP" ? "£" : "\\$";
  const marked = new RegExp(`${sign}\\s?\\d`).exec(caption);
  if (marked) return parseAmount(caption.slice(marked.index), currency);
  const cue = /\b(for|asking|asks|offered|offering|offers|wants?|price|paid|pay)\s+(\d[\d,]*(?:\.\d{1,2})?)\b/i.exec(caption);
  if (cue) return parseAmount(cue[2]!, currency);
  const numbers = caption.match(/\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  return numbers.length === 1 ? parseAmount(numbers[0]!, currency) : null;
}

/** Selling when someone offered to buy the things; buying (an ad or a quote) otherwise. */
export function photoMode(caption: string | undefined | null): PhotoMode {
  return caption && /\b(offer(ed|ing|s)?\s+(me|us|her|him|them|gran|mum|dad|\d|£|\$)|offered|selling|sell|sold|wants? to buy|buy (my|our|her|his|all of)|for the lot from)\b/i.test(caption)
    ? "sell"
    : "buy";
}

/** The family's money: the currency of its people's allowances (GBP when there is nobody yet). */
export async function householdCurrency(db: Db, householdId: string): Promise<Currency> {
  const [r] = await db.query<{ c: string | null }>("select allowance->'weekly'->>'currency' as c from spenders where household_id = $1 order by created_at limit 1", [householdId]);
  return r?.c === "USD" ? "USD" : "GBP";
}

// ---------- the check ----------

async function scan(deps: PhotoDeps, bytes: Buffer, currency: Currency, condition: Condition): Promise<Scene | null> {
  const base64 = bytes.toString("base64");
  const s = await deps.find(base64, currency, condition).catch((e: unknown) => {
    console.error("[spotter] photo check: finding things in the photo failed:", e instanceof Error ? e.message : e);
    return null;
  });
  if (s && s.things.length) return s;
  // The experimental endpoint failed (or found nothing): one ordinary image search of the whole photo instead.
  console.error(`[spotter] photo check: find products in image gave ${s ? "no things" : "no answer"}, so the whole photo is searched once instead`);
  const products = await deps.single({ base64 }, currency, [condition]).catch((e: unknown) => {
    console.error("[spotter] photo check: the whole photo search failed:", e instanceof Error ? e.message : e);
    return null;
  });
  if (!products) return null;
  return { size: null, things: [{ thing: WHOLE_PHOTO, bbox: null, categories: [], matches: products }], fallback: true };
}

export async function photoCheck(deps: PhotoDeps, input: PhotoInput): Promise<PhotoAnswer> {
  const img = imageFrom(input.bytes);
  if (!img) return { ok: false, status: 400, error: `Send a photo (JPEG, PNG or WEBP) under ${Math.floor(MAX_PHOTO_BYTES / 1_000_000)} MB.` };
  const condition: Condition = input.mode === "sell" ? "used" : "new";
  const key = `${input.currency}:${condition}:${createHash("sha256").update(img.bytes).digest("hex")}`;

  const hit = await deps.db.query<{ scene: Scene }>(`select scene from photo_cache where key = $1 and fetched_at > now() - interval '${CACHE_DAYS} days'`, [key]);
  if (hit[0]) return { ok: true, result: buildPhoto(hit[0].scene, input.mode, input.currency, input.quoted) };

  // A slot is taken before Channel3 is called, in one statement, and kept even if the call fails: Channel3 can charge
  // for a failed or empty answer, so retrying the same photo can never spend credits past the cap.
  const took = await deps.db.query(
    `insert into photo_checks (household_id) select $1
     where (select count(*) from photo_checks where at > now() - interval '1 day') < $2
       and (select count(*) from photo_checks where household_id = $1 and at > now() - interval '1 day') < $3
     returning 1`,
    [deps.householdId, deps.overall ?? 100, deps.perHousehold ?? 5],
  );
  if (!took.length) {
    console.error(`[spotter] photo check skipped for ${deps.householdId}: daily cap reached`);
    return { ok: false, status: 429, error: "Spotter has done all the photo checks it can today. Try again tomorrow." };
  }

  const scene = await scan(deps, img.bytes, input.currency, condition);
  if (!scene) return { ok: false, status: 502, error: "Real shop search isn't answering right now. Nothing was checked. Try again in a few minutes." };
  if (!scene.fallback) {
    // Only a full answer is cached: a fallback after a passing outage shouldn't stick for a week.
    try {
      await deps.db.query("insert into photo_cache (key, scene) values ($1, $2) on conflict (key) do update set scene = excluded.scene, fetched_at = now()", [key, JSON.stringify(scene)]);
    } catch (e) {
      console.error("[spotter] caching the photo check failed (the result is still used):", e instanceof Error ? e.message : e);
    }
  }
  return { ok: true, result: buildPhoto(scene, input.mode, input.currency, input.quoted) };
}
