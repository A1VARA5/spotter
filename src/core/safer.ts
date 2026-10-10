// The safer option: when Spotter stops or holds an AI agent's payment for shop reasons (hidden instructions, a fake
// shop price, a brand new shop, no named shop), it tells the agent where the same item is sold by a real retailer
// (Channel3), so a well behaved agent can fix its own mistake. The suggestion is stored here, server side, and an
// agent can only pay it back exactly: its own suggestion, under an hour old, once, same payee, price and item.
// Naming an offer id never approves anything: the replacement goes through the normal rules and AI check, and over
// the ask me amount it still waits for the spotter. The one thing it changes is that Spotter's own retailer doesn't
// count as a "first time" payee.
import { randomBytes } from "node:crypto";
import { getPayment, submitPayment, weekSpend, withdraw, type Deps, type Payment, type Spender } from "./lifecycle";
import { normCategory, normName } from "./rules";
import { formatMoney, type Currency } from "./types";
import type { Offer } from "./market";
import { sameProduct } from "@/market/channel3";

export type StopReason = "hidden instructions" | "fake shop price" | "brand new shop" | "no named shop";

export type SaferOption = {
  offer_id: string;
  title: string;
  retailer: string;
  price: number;
  price_text: string;
  currency: Currency;
  url: string;
  /** Why the first payment was stopped or held. */
  reason: StopReason;
  /** Plain words for the agent: what to call, with which payee and offer id. */
  guidance: string;
};

const FRESH_MINUTES = 60;
const TOO_CHEAP = 0.4; // same line as the price check: under 40% of the going rate is a fake shop tell
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const priceText =(o: Offer) => formatMoney({ amount: o.price, currency: o.currency });

/** "https://www.Currys.co.uk/x" and "currys.co.uk" are the same retailer. */
export const normDomain = (s: string) =>
  normName(s)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!;

/**
 * Why a payment was stopped or held for shop reasons, or null. Only these get a safer option: a payment stopped for
 * the agent's own reasons (over budget, a blocked category) wouldn't be any better at another shop.
 */
export function stopReason(p: Payment, opts: { unnamedShop?: boolean } = {}): StopReason | null {
  if (p.status !== "blocked" && p.status !== "needs_approval") return null;
  const flags = p.ai?.flags ?? [];
  if (flags.some((f) => f.kind === "gift_card_or_crypto" || f.kind === "friends_and_family")) return null;
  if (flags.some((f) => f.kind === "prompt_injection" && f.severity !== "low")) return "hidden instructions";
  if (flags.some((f) => f.kind === "price" && f.severity === "high")) return "fake shop price";
  if (flags.some((f) => f.kind === "new_shop" && f.severity !== "low")) return "brand new shop";
  if (opts.unnamedShop) return "no named shop";
  return null;
}

const guidance = (o: { retailer: string; offer_id: string; price_text: string; title: string }) =>
  `Order this instead with request_payment (or create_order) using payee ${o.retailer} and offer_id ${o.offer_id}, ` +
  `for exactly ${o.price_text}, item "${o.title}". Spotter still checks it, and your spotter may still need to approve it.`;

function toOption(id: string, offer: Offer, reason: StopReason): SaferOption {
  const base = { offer_id: id, title: offer.title, retailer: offer.domain, price: offer.price, price_text: priceText(offer), currency: offer.currency, url: offer.url, reason };
  return { ...base, guidance: guidance(base) };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Finds a genuine offer for the same item at a real retailer, within what the agent can still spend, stores it and
 * returns it. Null when there's no item, Channel3 has nothing good, or it can't be reached: no guess beats a bad one.
 */
export async function offerSaferOption(deps: Deps, p: Payment, spender: Spender, reason: StopReason): Promise<SaferOption | null> {
  const item = p.request.item?.trim();
  const currency = p.currency as Currency;
  if (!item || !deps.market) return null;
  if (spender.allowance.weekly.currency !== currency) return null;
  if (spender.allowance.blockedCategories.map(normCategory).includes(normCategory(p.request.category))) return null;

  let offers: Offer[] | null;
  try {
    offers = await deps.market(item, currency);
  } catch (e) {
    console.error(`[spotter] safer option search failed for ${p.id}:`, e instanceof Error ? e.message : e);
    return null;
  }
  if (!offers?.length) return null;

  const stopped = normDomain(p.request.payee.name);
  const real = offers.filter((o) => o.currency === currency && o.price > 0 && DOMAIN.test(normDomain(o.domain)) && normDomain(o.domain) !== stopped);
  const going = real.length >= 2 ? median(real.map((o) => o.price)) : 0;
  // The held payment's own reservation is let go when the agent switches, so it doesn't count against the replacement.
  const used = (await weekSpend(deps.db, spender.id, currency)) - (p.status === "needs_approval" ? Number(p.amount) : 0);
  const left = spender.allowance.weekly.amount - used;
  // Channel3's match lets one word of the item go missing; a listing with every word is the same item more surely.
  const words = tokens(item);
  const exact = (o: Offer) => (words.every((w) => tokens(o.title).includes(w)) ? 0 : 1);
  const pick = real
    .filter((o) => o.price >= going * TOO_CHEAP && o.price <= left)
    .sort((a, b) => exact(a) - exact(b) || a.price - b.price)[0];
  if (!pick) return null;

  const offer: Offer = { ...pick, domain: normDomain(pick.domain) };
  const id = `offer_${randomBytes(10).toString("hex")}`;
  await deps.db.query("insert into safer_options (id, payment_id, spender_id, offer, reason) values ($1, $2, $3, $4, $5)", [
    id,
    p.id,
    spender.id,
    JSON.stringify(offer),
    reason,
  ]);
  await deps.db.query("insert into events (payment_id, type, data) values ($1, 'safer_option_offered', $2)", [
    p.id,
    JSON.stringify({ offer_id: id, shop: offer.domain, price: offer.price }),
  ]);
  return toOption(id, offer, reason);
}

type Row = { id: string; payment_id: string; spender_id: string; offer: Offer; reason: StopReason; used_at: string | null; fresh: boolean };
const SELECT = `select id, payment_id, spender_id, offer, reason, used_at, created_at > now() - make_interval(mins => ${FRESH_MINUTES}) as fresh from safer_options`;

/** The latest unused, still fresh suggestion for one of this agent's payments (for pay_order and status replies). */
export async function saferOptionFor(db: Deps["db"], paymentId: string, agentId: string): Promise<SaferOption | null> {
  const rows = await db.query<Row>(`${SELECT} where payment_id = $1 and spender_id = $2 and used_at is null order by created_at desc limit 1`, [paymentId, agentId]);
  const r = rows[0];
  return r?.fresh ? toOption(r.id, r.offer, r.reason) : null;
}

export type SaferClaim = { payee: string; amount: number; currency: Currency; item?: string };

/**
 * Pays the safer option an agent was given, as a new payment linked to the stopped one. Every claim is checked against
 * what Spotter stored; anything that doesn't match is refused before a payment exists, and nothing reaches PayPal.
 */
export async function paySaferOption(
  deps: Deps,
  agentId: string,
  offerId: string,
  claim: SaferClaim,
  base: { category?: string; context: string },
): Promise<{ payment: Payment } | { error: string }> {
  const { db } = deps;
  const r = (await db.query<Row>(`${SELECT} where id = $1 and spender_id = $2`, [offerId, agentId]))[0];
  if (!r) return { error: "That offer_id isn't one Spotter suggested to you. Nothing was paid." };
  if (r.used_at) return { error: "That offer_id was already used. Nothing more was paid." };
  if (!r.fresh) return { error: "That offer has expired (Spotter's suggestions last an hour). Nothing was paid; ask again to get a fresh one." };
  const o = r.offer;
  if (normDomain(claim.payee) !== o.domain) return { error: `That offer is for ${o.domain}, so the payee has to be ${o.domain}. Nothing was paid.` };
  if (claim.amount !== o.price || claim.currency !== o.currency) {
    return { error: `That offer's price is ${priceText(o)}; the payment has to be exactly that. Nothing was paid.` };
  }
  if (claim.item?.trim() && normName(claim.item) !== normName(o.title) && !sameProduct(claim.item, o.title)) {
    return { error: `That offer is for "${o.title}"; it can only pay for the same item. Nothing was paid.` };
  }
  const from = await getPayment(db, r.payment_id);
  if (!from || from.spender_id !== agentId) return { error: "That offer_id isn't one Spotter suggested to you. Nothing was paid." };
  if (!["blocked", "needs_approval", "voided"].includes(from.status)) {
    return { error: `The payment this offer replaces is ${from.status.replace("_", " ")}, so it can't be replaced. Nothing was paid.` };
  }

  // Claimed in one conditional update, so two calls racing with the same offer id can't both pay.
  const claimed = await db.query(`update safer_options set used_at = now() where id = $1 and used_at is null returning id`, [offerId]);
  if (!claimed.length) return { error: "That offer_id was already used. Nothing more was paid." };

  if (from.status === "needs_approval") {
    const released = await withdraw(deps, from.id, "the agent (chose Spotter's safer option)");
    if (released.status !== "voided") {
      await db.query("update safer_options set used_at = null where id = $1", [offerId]);
      return { error: `Spotter couldn't release the first hold to ${from.request.payee.name}, so nothing new was ordered. Tell the user.` };
    }
  }

  const payment = await submitPayment(deps, {
    spenderId: agentId,
    money: { amount: o.price, currency: o.currency },
    payee: { name: o.domain, isNew: true },
    category: base.category?.trim() || from.request.category,
    method: "paypal_order",
    item: o.title,
    context: [
      `Spotter suggested this genuine offer (from Channel3) after it ${from.status === "blocked" ? "stopped" : "held"} a payment to ${from.request.payee.name} (${r.reason}): ${o.title} for ${priceText(o)} at ${o.domain}.`,
      base.context,
    ]
      .filter(Boolean)
      .join("\n\n"),
    saferFor: { paymentId: from.id, offerId, domain: o.domain, reason: r.reason, fromPayee: from.request.payee.name },
  });
  await db.query("update safer_options set used_by = $2 where id = $1", [offerId, payment.id]);
  await db.query("insert into events (payment_id, type, data) values ($1, 'replaced', $2)", [
    from.id,
    JSON.stringify({ to: payment.id, shop: o.domain, price: o.price, by: "agent" }),
  ]);
  return { payment };
}
