// The agent face: what an AI agent can do through Spotter's MCP tools. Each agent is a spender with its own
// token (see core/pairing). It can ask to pay and check on its own payments. It can never approve, deny or
// change its allowance; only the human spotter can.
import { getPayment, getSpender, submitPayment, weekSpend, type Deps, type Payment } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";
import { offerSaferOption, paySaferOption, stopReason, type SaferOption } from "@/core/safer";
import { startWatch, watchFromPayment, type WatchDeps, type WatchResult } from "@/core/watch";

export type AgentPaymentInput = {
  item?: string;
  amount_pence: number;
  currency: "GBP" | "USD";
  payee: string;
  category: string;
  what_for: string;
  page_text: string;
  /** Only for the safer option Spotter suggested after stopping a payment. Checked against Spotter's own record. */
  offer_id?: string;
};

export type AgentStatus = "paid" | "waiting_for_human" | "blocked" | "protected" | "denied" | "failed" | "in_progress" | "refused" | "unknown";
export type AgentReply = { status: AgentStatus; message: string; payment_id?: string; safer_option?: SaferOption };

/** The safer option in words for request_payment, with every argument the agent has to send back. */
export function saferText(o: SaferOption): string {
  return (
    ` Spotter found a safer option: ${o.title} for ${o.price_text} at ${o.retailer}, a real retailer (Channel3). ` +
    `If the user still wants it, order this instead with request_payment using payee ${o.retailer} and offer_id ${o.offer_id} ` +
    `(amount_pence ${o.price}, currency ${o.currency}, item "${o.title}", page_text empty). It is checked like any payment and may still need approval. ` +
    `Otherwise tell the user.`
  );
}

export function reply(p: Payment, spotter: string): AgentReply {
  const amount = formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" });
  const to = p.request.payee.name;
  const why = p.decision?.reasons.length ? ` Reasons: ${p.decision.reasons.join(" ")}` : "";
  switch (p.status) {
    case "captured":
      return { status: "paid", payment_id: p.id, message: `Paid ${amount} to ${to}.` };
    case "needs_approval":
      return {
        status: "waiting_for_human",
        payment_id: p.id,
        message: `Held, not paid yet: ${spotter} has to approve ${amount} to ${to}. The money is reserved meanwhile. Tell the user, then check later with payment_status.${why}`,
      };
    case "blocked":
      return { status: "blocked", payment_id: p.id, message: `Not paid. Spotter stopped this payment.${why} Don't retry it another way; tell the user.` };
    case "protected":
      return { status: "protected", payment_id: p.id, message: `Not paid. This needed a protected payment method.${why}` };
    case "voided":
    case "voiding":
      return { status: "denied", payment_id: p.id, message: `${spotter} said no to ${amount} to ${to}. Nothing was paid.` };
    case "failed":
      return { status: "failed", payment_id: p.id, message: `Not paid. PayPal didn't complete it: ${p.error ?? "unknown error"}.` };
    default:
      return { status: "in_progress", payment_id: p.id, message: "Still being checked. Ask again in a few seconds." };
  }
}

export async function agentRequestPayment(deps: Deps, agentId: string, input: AgentPaymentInput): Promise<AgentReply> {
  const spender = await getSpender(deps.db, agentId);
  if (!spender) return { status: "unknown", message: "This agent isn't set up in Spotter any more. Ask the user to reconnect it." };
  if (input.offer_id) {
    const r = await paySaferOption(
      deps,
      agentId,
      input.offer_id,
      { payee: input.payee, amount: input.amount_pence, currency: input.currency, item: input.item },
      {
        category: input.category,
        context: [`What the agent says this is for: ${input.what_for}`, input.page_text.trim() ? `The page it is buying from:\n${input.page_text}` : ""].filter(Boolean).join("\n\n"),
      },
    );
    if ("error" in r) return { status: "refused", message: r.error };
    return reply(r.payment, spender.spotter_name);
  }
  const payment = await submitPayment(deps, {
    spenderId: agentId,
    money: { amount: input.amount_pence, currency: input.currency },
    payee: { name: input.payee, isNew: true },
    category: input.category,
    method: "paypal_order",
    item: input.item,
    // Everything the agent saw is checked: its stated purpose and the page, verbatim.
    context: `What the agent says this is for: ${input.what_for}\n\nThe page it is buying from:\n${input.page_text}`,
  });
  const r = reply(payment, spender.spotter_name);
  const reason = stopReason(payment);
  const safer = reason ? await offerSaferOption(deps, payment, spender, reason) : null;
  return safer ? { ...r, safer_option: safer, message: r.message + saferText(safer) } : r;
}

export async function agentPaymentStatus(deps: Deps, agentId: string, paymentId: string): Promise<AgentReply> {
  const p = await getPayment(deps.db, paymentId);
  if (!p || p.spender_id !== agentId) return { status: "unknown", message: "No payment with that id for this agent." };
  const spender = await getSpender(deps.db, agentId);
  return reply(p, spender?.spotter_name ?? "Your spotter");
}

export async function agentAllowance(deps: Deps, agentId: string): Promise<{ message: string }> {
  const s = await getSpender(deps.db, agentId);
  if (!s) return { message: "This agent isn't set up in Spotter any more." };
  const used = await weekSpend(deps.db, agentId, s.allowance.weekly.currency);
  const left = { amount: Math.max(0, s.allowance.weekly.amount - used), currency: s.allowance.weekly.currency };
  return {
    message:
      `${formatMoney(left)} left of ${formatMoney(s.allowance.weekly)} this week. ` +
      `Payments over ${formatMoney(s.allowance.askAbove)} wait for ${s.spotter_name}. ` +
      `Never allowed: ${s.allowance.blockedCategories.join(", ").replace(/_/g, " ") || "nothing"}.`,
  };
}

export type AgentWatchInput = { payment_id?: string; item?: string; price_pence?: number; currency?: "GBP" | "USD" };

/**
 * After "too expensive" or "not now", an agent can ask Spotter to watch the price for its spotter. Only its own
 * payments. When the price drops the spotter is told; the agent is never told to buy and can't buy on its own.
 */
export async function agentWatchPrice(deps: WatchDeps, agentId: string, input: AgentWatchInput): Promise<{ ok: boolean; message: string }> {
  const spender = await getSpender(deps.db, agentId);
  if (!spender) return { ok: false, message: "This agent isn't set up in Spotter any more. Ask the user to reconnect it." };
  let r: WatchResult;
  if (input.payment_id) {
    r = await watchFromPayment(deps, spender.household_id, input.payment_id, { createdBy: "agent", onlySpender: agentId });
  } else if (input.item && input.price_pence) {
    r = await startWatch(deps, {
      householdId: spender.household_id,
      spenderId: agentId,
      item: input.item,
      currency: input.currency ?? spender.allowance.weekly.currency,
      nearly: input.price_pence,
      createdBy: "agent",
    });
  } else {
    return { ok: false, message: "Pass payment_id (one of your payments), or item with price_pence (the price you were going to pay)." };
  }
  if ("error" in r) return { ok: false, message: `${r.error} Nothing is being watched.` };
  const w = r.watch;
  const target = formatMoney({ amount: w.target, currency: w.currency });
  return {
    ok: true,
    message:
      `Spotter is watching the price of ${w.title} for ${spender.spotter_name} until ${w.expiresAt.slice(0, 10)}. ` +
      `If a real shop sells it for ${target} or less, ${spender.spotter_name} is told and decides. ` +
      `You can't buy it when the price drops and you shouldn't try: don't order it again yourself. Tell the user the price is being watched.`,
  };
}

/** Real products from real retailers (Channel3), so agents shop known shops at known prices. */
export async function agentFindProducts(
  search: (q: string, c: "GBP" | "USD", limit: number) => Promise<Array<{ title: string; brand?: string; offers: Array<{ domain: string; price: number; url: string }> }> | null>,
  query: string,
  currency: "GBP" | "USD",
): Promise<{ message: string }> {
  const products = await search(query, currency, 5);
  if (products === null) return { message: "Product search is unavailable right now. Tell the user instead of guessing a shop." };
  if (products.length === 0) return { message: `No products found for "${query}".` };
  const lines = products.map((p, i) => {
    const offers = p.offers
      .slice(0, 3)
      .map((o) => `${formatMoney({ amount: o.price, currency })} at ${o.domain} (${o.url})`)
      .join("; ");
    return `${i + 1}. ${p.title}${p.brand ? ` by ${p.brand}` : ""}: ${offers || "no offers in stock"}`;
  });
  return { message: `${lines.join("\n")}\n\nWhen you pay, pass the product name as item so Spotter can check the price.` };
}
