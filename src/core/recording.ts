// Recording mode, for the demo video: the video rules ban third party trademarks, and real listings (Channel3) name
// real UK retailers and real product brands. With recording mode on, text a person reads swaps those for neutral
// words ("a real UK shop", "real shop 2", "wireless headphones"). Prices stay, and so do Spotter's own made up shops
// and addresses, so every demo still reads true. Links keep their real address: only the words change.
// Turned on per browser with ?rec=1 (a cookie, see src/proxy.ts) and off with ?rec=0.
import { RETAILERS } from "@/agents/shops";

export const REC_COOKIE = "spotter_rec";

/** ?rec=1 is on, ?rec=0 is off, anything else leaves the browser as it was (null). */
export function recToggle(query: URLSearchParams): boolean | null {
  const v = query.get("rec");
  return v === "1" ? true : v === "0" ? false : null;
}

/** Spotter's own made up shops, scam pages and inboxes: kept as written, since they are no one's trademark. */
const OWN = new Set([
  "spotter-pay.vercel.app",
  "harbourline-audio.co.uk",
  "harbourline-packaging.co",
  "sound-bargains.shop",
  "parcel-redelivery.co",
  "parcel-redelivery.top",
  "rm-parcel-redelivery.top",
  "royal-mail-fees.com",
  "secure-paypal.net",
  "hmrc.help",
  "rnyalmail.vercel.app",
  "earbuds-outlet.shop",
  "bestdealz.shop",
  "cheap-watches.shop",
  "homingbox.net",
  "soundhouse.ie",
  "hartwell.co.uk",
  "pennyworth-electrics.co.uk",
  "larkspur-gifts.co.uk",
  "copperpot-home.co.uk",
]);

const TLD = String.raw`(?:co\.uk|org\.uk|com|net|org|uk|shop|store|co|io|ie|eu|de|fr|nl|es|app|online|site|info|biz|xyz|top|live|help|support|example)`;
const HOST = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+${TLD}`;
// A web address in text: an optional scheme, the host, an optional path. Never part of a longer word, and never the
// end of an email address (a reply address is evidence, not a shop).
const ADDRESS = new RegExp(String.raw`(?<![\w@.-])(?:https?:\/\/)?(${HOST})(?![\w-])(?:\/[^\s)"'<>]*)?`, "gi");
const ONLY_HOST = new RegExp(String.raw`^(?:https?:\/\/)?(?:[\w.+-]+@)?(${HOST})(?:\/\S*)?$`, "i");
const TLD_END = new RegExp(String.raw`\.${TLD}$`, "i");

// General hosting addresses are not shops: "the page is on vercel.app" must never read "on a real UK shop", and a
// page hosted on one (a scam page in a demo) is no retailer either.
// Government, NHS, police and universities, and PayPal itself: named in safety advice, never a shop.
const PUBLIC = /(^|\.)(?:gov|nhs|police|ac)\.uk$|(^|\.)paypal\.co\.uk$/;
const HOSTING = ["vercel.app", "netlify.app", "github.io", "pages.dev", "web.app", "firebaseapp.com", "blogspot.com", "paypal.com"];

function ownHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return OWN.has(h) || h.endsWith(".example") || HOSTING.some((x) => h === x || h.endsWith(`.${x}`)) || PUBLIC.test(h);
}

/** "www.argos.co.uk" and the name "Argos" are the same shop: "argos". */
const shopKey = (host: string) => host.toLowerCase().replace(/^www\./, "").replace(TLD_END, "").split(".").pop() ?? host;

type Shop = { re: RegExp; key: string };
const SHOPS: Shop[] = [
  ...RETAILERS.map((r) => ({ re: new RegExp(r.re.source, r.re.flags.replace("g", "") + "g"), key: shopKey(r.stem) })),
  { re: /\bdebenhams\b/gi, key: "debenhams" },
];
/** Retailers Spotter knows are real shops: only these are ever called "a real UK shop" inside a sentence. */
const KNOWN = new Set([...SHOPS.map((s) => s.key), "dunelm", "johnlewis", "currys", "argos", "lakeland", "vonhaus", "procook", "wilko", "habitat", "ocado", "lecreuset"]);

// Product brands and product lines that name a maker. Case sensitive: these are proper nouns.
const BRAND = new RegExp(
  String.raw`\b(?:Sony|Bose|Apple|AirPods|iPhone|iPad|MacBook|Samsung|Galaxy Buds|JBL|Sennheiser|Beats|Powerbeats|Le Creuset|Tefal|Philips|Dyson|Logitech|Anker|Soundcore|Nintendo|PlayStation|PS5|PS4|Xbox|Panasonic|Lenovo|Huawei|Xiaomi|OnePlus|Garmin|Fitbit|Canon|Nikon|GoPro|Smeg|KitchenAid|Nespresso|De'Longhi|Breville|Russell Hobbs|Morphy Richards|Kenwood|Bosch|Hotpoint|Skullcandy|Audio-Technica|Jabra|Shure|Bang & Olufsen|SteelSeries|Razer|Corsair|HyperX|Belkin|Kindle|Google Pixel|Pixel Buds|Microsoft Surface|Staub|Zwilling|ProCook|Circulon|Salter|Nike|Adidas|LEGO|Lego)\b`,
  "g",
);
// After a brand: model words ("WH-1000XM5", "Pro", "1.7L"), brackets ("(23 cm)") and dashes belong to the same name.
// "Apple ID", "Apple Pay": an account or a way to pay, kept so safety advice still reads.
const NOT_PRODUCT = /^\s+(?:ID|Pay|Account|Wallet|Card|Store)\b/;
const NAME_TOKEN = /^\s+(?:[A-Z0-9][\w'&+/-]*(?:\.\d\w*)*|\([^)]*\)|[-–])/;

const NOUNS: Array<[RegExp, string]> = [
  [/\bhead(?:phones?|sets?)\b|\bover[- ]ear\b/i, "headphones"],
  [/\bear(?:buds?|phones?)\b|\bin[- ]ear\b|\bairpods\b|\w*buds\b/i, "earbuds"],
  [/\bskillets?\b/i, "skillet"],
  [/\bfrying pans?\b|\bsaucepans?\b|\bpans?\b/i, "pan"],
  [/\bkettles?\b/i, "kettle"],
  [/\bdesk lamps?\b/i, "desk lamp"],
  [/\blamps?\b/i, "lamp"],
  [/\bmug sets?\b/i, "mug set"],
  [/\bmugs?\b/i, "mug"],
  [/\bsmart ?watch(?:es)?\b/i, "smartwatch"],
  [/\bwatch(?:es)?\b/i, "watch"],
  [/\bsound ?bars?\b/i, "soundbar"],
  [/\bspeakers?\b/i, "speaker"],
  [/\bphone cases?\b/i, "phone case"],
  [/\bpower ?banks?\b/i, "power bank"],
  [/\bchargers?\b/i, "charger"],
  [/\blaptops?\b|\bmacbook\b/i, "laptop"],
  [/\btablets?\b|\bipad\b/i, "tablet"],
  [/\b(?:smart)?phones?\b|\biphone\b/i, "phone"],
  [/\bair fryers?\b/i, "air fryer"],
  [/\btoasters?\b/i, "toaster"],
  [/\bblenders?\b/i, "blender"],
  [/\bcoffee (?:machine|maker)s?\b/i, "coffee machine"],
  [/\bvacuum(?: cleaner)?s?\b/i, "vacuum cleaner"],
  [/\b(?:tv|television)s?\b/i, "TV"],
  [/\bmonitors?\b/i, "monitor"],
  [/\bkeyboards?\b/i, "keyboard"],
  [/\bmouse\b|\bmice\b/i, "mouse"],
  [/\bcameras?\b/i, "camera"],
  [/\bcontrollers?\b/i, "controller"],
  [/\bconsoles?\b|\bps5\b|\bxbox\b/i, "games console"],
  [/\btrainers?\b|\bsneakers?\b|\bshoes?\b/i, "trainers"],
  [/\bjackets?\b/i, "jacket"],
  [/\bdrills?\b/i, "drill"],
  [/\bknife sets?\b|\bknives\b|\bknife\b/i, "knife set"],
  [/\bcasseroles?\b|\bdutch ovens?\b/i, "casserole dish"],
];
const NOUN_WORDS = [/^\s+[a-z]+/, /^\s+[a-z]+\s+[a-z]+/];

const nounOf = (text: string) => NOUNS.find(([re]) => re.test(text))?.[1] ?? null;

/**
 * A listing title as the plain product: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones" is
 * "wireless headphones". No brand, model or product line name ever comes through; "this product" when the title
 * doesn't say what it is.
 */
export function recTitle(title: string): string {
  const noun = nounOf(title);
  if (!noun) return "this product";
  const lead = [/\bcast[- ]iron\b/i.test(title) && "cast iron", /\belectric\b/i.test(title) && "electric", /\bwireless\b|\bbluetooth\b/i.test(title) && "wireless"].filter(Boolean);
  return [...lead, noun].join(" ");
}

/** "a real UK shop" for the first (or only) shop, "real shop 2" and on for the next ones. Spotter's own names stay. */
export function recShop(name: string, n = 1): string {
  const m = ONLY_HOST.exec(name.trim());
  const own = m ? ownHost(m[1]!) : !SHOPS.some((s) => new RegExp(s.re.source, s.re.flags.replace("g", "")).test(name));
  if (own) return name;
  return n >= 2 ? `real shop ${n}` : "a real UK shop";
}

type Hit = { start: number; end: number; shop?: string; known?: boolean; with?: string };

/**
 * Text a person reads, with real retailers' names and addresses and real product brands swapped for neutral words.
 * Different shops in one text are numbered in the order they come ("a real UK shop", then "real shop 2"); a shop's
 * name and its address count as one shop. Prices and everything else stay exactly as written.
 */
export function recText(text: string): string {
  return swap(text, true);
}

/**
 * A name on its own, like a payee: a known retailer or a product brand is swapped, an address Spotter doesn't know is
 * kept, since on a payee it is the evidence (a scam shop's address must stay readable).
 */
export function recName(name: string): string {
  return swap(name, false);
}

function swap(text: string, unknownToo: boolean): string {
  if (!text) return text;
  const hits: Hit[] = [];
  for (const m of text.matchAll(ADDRESS)) {
    const host = m[1]!;
    const key = shopKey(host);
    if (ownHost(host) || (!unknownToo && !KNOWN.has(key))) continue;
    let end = m.index + m[0].length;
    // A path never takes the sentence's own full stop or comma with it.
    while (m[0].length > host.length && /[.,;:!?]/.test(text[end - 1]!)) end--;
    hits.push({ start: m.index, end, shop: key, known: KNOWN.has(key) });
  }
  for (const s of SHOPS) {
    for (const m of text.matchAll(s.re)) {
      const gift = /^\s+gift[\s-]?cards?\b/i.exec(text.slice(m.index + m[0].length));
      // "Never pay with Amazon gift cards" is advice about a way to pay, not a shop: the name just goes.
      if (gift) hits.push({ start: m.index, end: m.index + m[0].length + gift[0].length - gift[0].trimStart().length, with: "" });
      else hits.push({ start: m.index, end: m.index + m[0].length, shop: s.key, known: true });
    }
  }
  for (const m of text.matchAll(BRAND)) {
    let end = m.index + m[0].length;
    if (NOT_PRODUCT.test(text.slice(end))) continue;
    for (let t = NAME_TOKEN.exec(text.slice(end)); t; t = NAME_TOKEN.exec(text.slice(end))) end += t[0].length;
    // "Sony WH-1000XM5 headphones": the plain noun right after the name is part of it ("desk lamp" is two words).
    const next = NOUN_WORDS.map((re) => re.exec(text.slice(end))?.[0]).find((w) => w && nounOf(w));
    if (next && !nounOf(text.slice(m.index, end))) end += next.length;
    const span = text.slice(m.index, end);
    hits.push({ start: m.index, end, with: nounOf(span) ? recTitle(span) : "the product" });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const order: string[] = [];
  let out = "";
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    let words = h.with ?? "";
    if (h.shop !== undefined) {
      if (!order.includes(h.shop)) order.push(h.shop);
      const n = order.indexOf(h.shop) + 1;
      // Only a retailer Spotter knows is called real; any other address gets words that claim nothing about it.
      words = h.known ? (n === 1 ? "a real UK shop" : `real shop ${n}`) : n === 1 ? "a website" : `website ${n}`;
    }
    out += text.slice(at, h.start) + words;
    at = h.end;
  }
  return out + text.slice(at);
}
