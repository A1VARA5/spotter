// Sanity for the going rate: a generic item ("kettle", "cast iron skillet", "wireless earbuds") is priced against
// ordinary listings, not against a fashion shop's earbuds or a £169 designer pan that happens to share its words.
// Three rules, all made by code from the listings themselves:
// - fashion shops are left out unless the item is something worn or carried;
// - designer brands are left out unless the item names that brand;
// - when the prices split at a big gap (2.5x or more) and the cheap side has at least two shops, the expensive side
//   is left out. A "premium" or "designer" item skips the last two rules: it is meant to be compared with those.
import type { Offer } from "@/core/market";

const FASHION_SHOP = /(fashion|clothing|apparel|boutique|couture)/i;
const WORN = /\b(dress|dresses|shirt|t-shirt|top|jeans|trousers|skirt|jacket|coat|jumper|hoodie|shoe|shoes|trainers|boots?|sandals?|bag|handbag|scarf|hat|jewell?ery|necklace|bracelet|earrings?|ring|watch|sunglasses|clothes|clothing|fashion)\b/i;
const PREMIUM_ITEM = /\b(premium|designer|luxury|top[\s-]?end|high[\s-]?end|flagship)\b/i;

/** Brands whose prices sit far above the everyday version of the same thing. Matched on the listing's brand field. */
const DESIGNER = ["le creuset", "staub", "smeg", "dualit", "kitchenaid", "de longhi", "delonghi", "dyson", "apple", "beats", "bose", "sony", "bang olufsen", "bowers wilkins", "sennheiser"];

const GAP = 2.5;
const MIN_CHEAP_SHOPS = 2;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const shopKey = (domain: string) => domain.toLowerCase().replace(/^www\./, "");
const label = (domain: string) => shopKey(domain).split(".")[0] ?? "";

/** True when the item text names the brand (every word of it). */
function names(item: string, brand: string): boolean {
  const have = ` ${words(item)} `;
  const want = words(brand).split(" ").filter(Boolean);
  return want.length > 0 && want.every((w) => have.includes(` ${w} `));
}

const designer = (brand: string | undefined) => {
  if (!brand) return false;
  const b = words(brand).replace(/\band\b/g, " ").replace(/\s+/g, " ");
  return DESIGNER.some((d) => b === d || b.startsWith(`${d} `));
};

const tokens = (s: string) => new Set(words(s).split(" ").filter(Boolean));

/**
 * Designer listings left out of a generic item's going rate. A designer listing stays when the item names its brand,
 * or when its title shares a word with the item that no ordinary listing has (a model name like "AirPods" or "Pulse":
 * then it may be the very thing being bought). If only designer listings matched, they all stay: never nothing.
 */
function withoutDesigner(offers: Offer[], item: string): Offer[] {
  const want = tokens(item);
  const ordinary = offers.filter((o) => !designer(o.brand));
  if (!ordinary.length) return offers;
  const plainWords = new Set(ordinary.flatMap((o) => [...tokens(o.title)]));
  const modelWord = (o: Offer) => [...tokens(o.title)].some((t) => want.has(t) && !plainWords.has(t));
  return offers.filter((o) => !designer(o.brand) || names(item, o.brand!) || modelWord(o));
}

/** The cheapest price per shop, low to high. */
function shopPrices(offers: Offer[]): number[] {
  const best = new Map<string, number>();
  for (const o of offers) {
    const k = shopKey(o.domain);
    best.set(k, Math.min(best.get(k) ?? Infinity, o.price));
  }
  return [...best.values()].sort((a, b) => a - b);
}

/**
 * The listings that can fairly set the going rate for this item. Used ones pass through the same rules (they only
 * ever count for "priced like a used one"). Never adds anything; an empty item leaves the listings as they are.
 */
export function plausibleOffers(offers: Offer[], item: string): Offer[] {
  const text = item.trim();
  if (!text) return offers;
  let kept = WORN.test(text) ? offers : offers.filter((o) => !FASHION_SHOP.test(label(o.domain)));
  if (PREMIUM_ITEM.test(text)) return kept;
  kept = withoutDesigner(kept, text);
  // An item that names a brand ("Le Creuset skillet") is priced against that brand's listings, gap or not.
  if (kept.some((o) => o.brand && names(text, o.brand))) return kept;
  // The price spread: one price per shop, cut at the first big gap from the bottom that leaves two or more shops below.
  const prices = shopPrices(kept.filter((o) => o.condition !== "used"));
  for (let i = MIN_CHEAP_SHOPS - 1; i < prices.length - 1; i++) {
    if (prices[i + 1]! >= prices[i]! * GAP) {
      const ceiling = prices[i + 1]!;
      return kept.filter((o) => o.price < ceiling);
    }
  }
  return kept;
}
