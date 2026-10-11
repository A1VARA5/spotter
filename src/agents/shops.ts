// Shop names in a case file must come from this case's tool results (the Channel3 listings, a link that was opened),
// never from the model's own memory: "check Currys or Argos" is advice nobody checked, and a shop the model
// remembers may not sell this product or this price. Code backs the prompt rule up with a list of well known
// retailers: a line naming one that no tool result mentions is dropped.

/** A retailer: its name as written, how it is spotted in text, and the stem its web address carries. */
type Retailer = { name: string; re: RegExp; stem: string };

const r = (name: string, re: RegExp, stem: string): Retailer => ({ name, re, stem });

export const RETAILERS: readonly Retailer[] = [
  r("Currys", /\bcurrys\b/i, "currys"),
  r("Argos", /\bargos\b/i, "argos"),
  r("John Lewis", /\bjohn\s*lewis\b/i, "johnlewis"),
  r("Amazon", /\bamazon\b/i, "amazon"),
  r("eBay", /\bebay\b/i, "ebay"),
  r("AO", /\bAO(\.com)?\b/, "ao.com"),
  r("Very", /\bvery\.co\.uk\b/i, "very.co.uk"),
  r("Richer Sounds", /\bricher\s*sounds\b/i, "richersounds"),
  r("Tesco", /\btesco\b/i, "tesco"),
  r("Sainsbury's", /\bsainsbury'?s?\b/i, "sainsburys"),
  r("Asda", /\basda\b/i, "asda"),
  // Ordinary words as well as shops: sourced only by their web address (or the capitalised name).
  r("Boots", /\bBoots\b/, "boots.com"),
  r("Superdrug", /\bsuperdrug\b/i, "superdrug"),
  r("Halfords", /\bhalfords\b/i, "halfords"),
  r("Screwfix", /\bscrewfix\b/i, "screwfix"),
  r("B&Q", /\bB\s*&\s*Q\b|\bdiy\.com\b/i, "diy.com"),
  r("Wickes", /\bwickes\b/i, "wickes"),
  r("Dunelm", /\bdunelm\b/i, "dunelm"),
  r("IKEA", /\bikea\b/i, "ikea"),
  r("Marks & Spencer", /\bmarks\s*(&|and)\s*spencer\b|\bM&S\b/i, "marksandspencer"),
  r("Selfridges", /\bselfridges\b/i, "selfridges"),
  r("Harrods", /\bharrods\b/i, "harrods"),
  r("Lakeland", /\bLakeland\b/, "lakeland.co.uk"),
  r("Robert Dyas", /\brobert\s*dyas\b/i, "robertdyas"),
  r("Smyths", /\bsmyths\b/i, "smyths"),
  r("Ebuyer", /\bebuyer\b/i, "ebuyer"),
  r("Scan", /\bscan\.co\.uk\b/i, "scan.co.uk"),
  r("Overclockers", /\boverclockers\b/i, "overclockers"),
  r("CeX", /\bCeX\b/, "cex"),
  r("Back Market", /\bback\s*market\b/i, "backmarket"),
  r("Apple Store", /\bapple\s*store\b/i, "apple.com"),
  r("Best Buy", /\bbest\s*buy\b/i, "bestbuy"),
  r("Walmart", /\bwalmart\b/i, "walmart"),
  r("Costco", /\bcostco\b/i, "costco"),
  r("Newegg", /\bnewegg\b/i, "newegg"),
  r("B&H", /\bB\s*&\s*H\b|\bbhphotovideo\b/i, "bhphotovideo"),
  r("Wayfair", /\bwayfair\b/i, "wayfair"),
  r("Zalando", /\bzalando\b/i, "zalando"),
  r("Etsy", /\betsy\b/i, "etsy"),
  r("Temu", /\btemu\b/i, "temu"),
  r("Shein", /\bshein\b/i, "shein"),
  r("AliExpress", /\baliexpress\b/i, "aliexpress"),
  r("Gumtree", /\bgumtree\b/i, "gumtree"),
  r("Vinted", /\bvinted\b/i, "vinted"),
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Safety advice about paying ("never pay with Amazon gift cards") names a brand, not a shop to buy from.
const GIFT_CARDS = /\bgift[\s-]?cards?\b/i;

/**
 * The well known retailers a sentence names that none of the sourced text mentions. Sourced text is what this case's
 * tools returned (listing domains, link hosts, summaries) plus the payment's own payee and item. A retailer counts as
 * sourced only when that text names it as a whole word (its name, or its web address), never inside another word.
 */
export function unsourcedShops(text: string, sourced: readonly string[]): string[] {
  if (GIFT_CARDS.test(text)) return [];
  const corpus = sourced.join("\n");
  return RETAILERS.filter((x) => x.re.test(text) && !x.re.test(corpus) && !new RegExp(`(^|[^a-z0-9-])${esc(x.stem)}(?![a-z0-9-])`, "i").test(corpus)).map((x) => x.name);
}
