// A labelled sample month for demo families, so a brand new demo has something to look at in Watchtower.
// Only demo households get it, every row is marked sample, and the page says so. It never touches the
// database or PayPal. The story: Gran gets a "Hi Mum" scam and a fake parcel redelivery text on the same day,
// the shopping agent lands on a booby trapped shop, and Leo meets a free game coins site.
import type { Payment, Spender } from "@/core/lifecycle";
import type { Flag } from "@/core/grounding";
import type { PaymentMethod } from "@/core/types";
import { SAMPLE_PREFIX, SAMPLE_WATCH_PREFIX } from "./data";
import type { WatchView } from "@/core/watch";

export { SAMPLE_WATCH_PREFIX };

type Kind = Spender["kind"];
type Entry = {
  who: Kind;
  hoursAgo: number;
  payee: string;
  pence: number;
  category: string;
  status: Payment["status"];
  method?: PaymentMethod;
  isNew?: boolean;
  flags?: Flag[];
  reason?: string;
  /** A made up price check, as Channel3 would have stored it: item, cheapest retailer and median, in pence. */
  price?: { item: string; shop: string; cheapest: number; median: number; offers: number };
};

const f = (kind: Flag["kind"], severity: Flag["severity"], why: string): Flag => ({ kind, severity, quote: "", why });
const D = 24;

const STORY: Entry[] = [
  // Shopping agent
  { who: "agent", hoursAgo: 26 * D, payee: "Corner Grocer", pence: 7240, category: "groceries", status: "captured" },
  { who: "agent", hoursAgo: 22 * D, payee: "Clay & Kiln", pence: 2400, category: "gifts", status: "captured", price: { item: "Hand thrown mug set", shop: "larkspur-gifts.co.uk", cheapest: 2400, median: 2650, offers: 3 } },
  { who: "agent", hoursAgo: 19 * D, payee: "Corner Grocer", pence: 6815, category: "groceries", status: "captured" },
  { who: "agent", hoursAgo: 15 * D, payee: "earbuds-outlet.shop", pence: 21900, category: "electronics", status: "voided", isNew: true, flags: [f("price", "medium", "Real shops charge about £169 for these."), f("new_shop", "medium", "The shop's website is 6 days old.")], reason: "The price and the shop both looked wrong.", price: { item: "Pro wireless earbuds 2", shop: "harbourline-audio.co.uk", cheapest: 15900, median: 16900, offers: 5 } },
  { who: "agent", hoursAgo: 12 * D, payee: "Corner Grocer", pence: 7012, category: "groceries", status: "captured" },
  { who: "agent", hoursAgo: 9 * D, payee: "Everything Store", pence: 1899, category: "household", status: "captured", price: { item: "Steel kettle 1.7L", shop: "copperpot-home.co.uk", cheapest: 1549, median: 1699, offers: 4 } },
  { who: "agent", hoursAgo: 7 * D, payee: "sound-bargains.shop", pence: 2499, category: "electronics", status: "blocked", isNew: true, flags: [f("price", "high", "£24.99 is far below what real shops charge (around £169 across 5 retailers). Prices this low are a fake shop tell."), f("new_shop", "medium", "Nobody in the Spotter network has paid this shop before.")], reason: "The price was too good to be true.", price: { item: "Pro wireless earbuds 2", shop: "harbourline-audio.co.uk", cheapest: 15900, median: 16900, offers: 5 } },
  { who: "agent", hoursAgo: 6 * D, payee: "Lampshade Lane", pence: 2999, category: "household", status: "captured", price: { item: "LED desk lamp", shop: "pennyworth-electrics.co.uk", cheapest: 2499, median: 2799, offers: 4 } },
  { who: "agent", hoursAgo: 5 * D, payee: "Corner Grocer", pence: 6630, category: "groceries", status: "captured" },
  { who: "agent", hoursAgo: 3 * D, payee: "Cheap-Electronix", pence: 24900, category: "electronics", status: "blocked", isNew: true, flags: [f("prompt_injection", "high", "The shop page hid text telling the agent to pay without asking."), f("new_shop", "medium", "Nobody in the Spotter network has paid this shop before.")], reason: "The shop tried to give your agent orders." },
  { who: "agent", hoursAgo: 2 * D, payee: "Supper Run", pence: 2350, category: "food", status: "captured" },
  { who: "agent", hoursAgo: 1 * D, payee: "Corner Grocer", pence: 5890, category: "groceries", status: "captured" },
  // Gran
  { who: "person", hoursAgo: 25 * D, payee: "High Street Chemist", pence: 1250, category: "health", status: "captured" },
  { who: "person", hoursAgo: 21 * D, payee: "FreshCrate", pence: 6420, category: "groceries", status: "captured" },
  { who: "person", hoursAgo: 18 * D, payee: "Tax Refunds Team", pence: 4999, category: "tax", status: "blocked", isNew: true, flags: [f("impersonation", "high", "The tax office never asks for a fee to send a refund.")], reason: "A stranger was pretending to be the tax office." },
  { who: "person", hoursAgo: 14 * D, payee: "FreshCrate", pence: 5880, category: "groceries", status: "captured" },
  { who: "person", hoursAgo: 11 * D, payee: "High Street Chemist", pence: 899, category: "health", status: "captured" },
  { who: "person", hoursAgo: 10 * D, payee: "Dave (local marketplace)", pence: 8500, category: "furniture", status: "protected", method: "friends_and_family", isNew: true, flags: [f("friends_and_family", "high", "The seller asked for Friends and Family, which has no buyer protection.")], reason: "Not sent as Friends and Family. Told to pay with Goods and Services, which has buyer protection." },
  { who: "person", hoursAgo: 7 * D, payee: "FreshCrate", pence: 6105, category: "groceries", status: "captured" },
  { who: "person", hoursAgo: 3 * D, payee: "Market Hall", pence: 3100, category: "groceries", status: "captured" },
  { who: "person", hoursAgo: 2 * D, payee: "High Street Chemist", pence: 1475, category: "health", status: "captured" },
  { who: "person", hoursAgo: 20, payee: "parcel-redelivery.co", pence: 299, category: "post", status: "blocked", isNew: true, flags: [f("impersonation", "high", "Pretends to be the post office from a look alike website.")], reason: "A fake parcel redelivery fee." },
  { who: "person", hoursAgo: 3, payee: "New number (Hi Mum)", pence: 40000, category: "family", status: "blocked", method: "friends_and_family", isNew: true, flags: [f("impersonation", "high", "Says it's family texting from a new number."), f("pressure", "medium", "Asks for the money today."), f("friends_and_family", "high", "Wants Friends and Family, which can't be reversed.")], reason: "A stranger was pretending to be family." },
  // Leo
  { who: "kid", hoursAgo: 24 * D, payee: "BlockWorld", pence: 499, category: "games", status: "captured" },
  { who: "kid", hoursAgo: 20 * D, payee: "TuneBox", pence: 599, category: "music", status: "captured" },
  { who: "kid", hoursAgo: 17 * D, payee: "BlockWorld", pence: 499, category: "games", status: "captured" },
  { who: "kid", hoursAgo: 16 * D, payee: "free-blockcoins.gg", pence: 999, category: "games", status: "blocked", method: "gift_card", isNew: true, flags: [f("gift_card_or_crypto", "high", "Asks for a gift card code to unlock free BlockCoins.")], reason: "Free coin sites take gift cards and give nothing." },
  { who: "kid", hoursAgo: 13 * D, payee: "GameShelf", pence: 799, category: "games", status: "captured" },
  { who: "kid", hoursAgo: 8 * D, payee: "BlockWorld", pence: 499, category: "games", status: "captured" },
  { who: "kid", hoursAgo: 4 * D, payee: "parcel-redelivery.co", pence: 199, category: "post", status: "voided", isNew: true, flags: [f("impersonation", "high", "The same fake parcel site that texted Gran.")], reason: "Sam denied it." },
  { who: "kid", hoursAgo: 1 * D, payee: "BlockWorld", pence: 499, category: "games", status: "captured" },
];

/**
 * What the scam radar shows for the sample month's payees: made up like the rest of the sample, and
 * marked Sample on the board. Real payees always get real Spotter network counts.
 */
export const SAMPLE_NETWORK: Record<string, number> = {
  "parcel-redelivery.co": 4,
  "tax refunds team": 6,
  "free-blockcoins.gg": 3,
  "cheap-electronix": 2,
  "earbuds-outlet.shop": 1,
  "sound-bargains.shop": 5,
};

export function sampleMonth(spenders: Spender[], now = new Date()): Payment[] {
  const first = (k: Kind) => spenders.find((s) => s.kind === k);
  return STORY.flatMap((e, i): Payment[] => {
    const s = first(e.who);
    if (!s) return [];
    const id = `${SAMPLE_PREFIX}${String(i).padStart(2, "0")}`;
    const at = new Date(now.getTime() - e.hoursAgo * 3600_000).toISOString();
    const flags = e.flags ?? [];
    const outcome = e.status === "blocked" ? "block" : e.status === "protected" ? "protect" : flags.length ? "ask" : "allow";
    return [
      {
        id,
        spender_id: s.id,
        request: {
          id,
          spenderId: s.id,
          money: { amount: e.pence, currency: "GBP" },
          payee: { name: e.payee, isNew: e.isNew ?? false },
          category: e.category,
          method: e.method ?? "paypal_order",
          context: "",
          createdAt: at,
          ...(e.price ? { item: e.price.item } : {}),
        },
        decision: { outcome, reasons: [e.reason ?? "Within the rules."], flags },
        ai: null,
        market: e.price
          ? {
              item: e.price.item,
              flag: flags.find((x) => x.kind === "price") ?? null,
              median: e.price.median,
              offers: e.price.offers,
              cheapest: { title: e.price.item, domain: e.price.shop, price: e.price.cheapest, currency: "GBP", url: `https://${e.price.shop}/` },
            }
          : null,
        case_file: null,
        status: e.status,
        amount: e.pence,
        currency: "GBP",
        paypal_order_id: null,
        paypal_authorization_id: null,
        paypal_capture_id: null,
        approve_url: null,
        error: null,
        decided_by: null,
        created_at: at,
        updated_at: at,
      },
    ];
  });
}

/**
 * The sample month's price watch: after Sam denied the agent's £219 earbuds (sold at real shops for about £159),
 * Spotter is watching the price. Made up like the rest of the sample and marked Sample; never at Channel3.
 */
export function sampleWatches(spenders: Spender[], now = new Date()): WatchView[] {
  const agent = spenders.find((s) => s.kind === "agent");
  if (!agent) return [];
  const day = (n: number) => new Date(now.getTime() - n * 24 * 3600_000).toISOString();
  return [
    {
      id: `${SAMPLE_WATCH_PREFIX}00`,
      paymentId: null,
      who: agent.name,
      item: "Pro wireless earbuds 2",
      title: "Pro wireless earbuds 2",
      currency: "GBP",
      nearlyPaid: 21900,
      target: 15400,
      best: { price: 15900, shop: "harbourline-audio.co.uk", url: "" },
      saving: null,
      status: "watching",
      history: { source: "checks", points: [16900, 16900, 16500, 15900].map((price, i) => ({ at: day(12 - i * 4), price })) },
      createdAt: day(14),
      expiresAt: day(-1),
      lastCheckedAt: day(0),
      example: false,
      createdBy: "spotter",
    },
  ];
}
