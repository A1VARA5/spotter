// The agent face: what an AI agent can do through Spotter's MCP tools. Each agent is a spender with its own
// token (see core/pairing). It can ask to pay and check on its own payments. It can never approve, deny or
// change its allowance; only the human spotter can.
import { getPayment, getSpender, submitPayment, weekSpend, type Deps, type Payment } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";

export type AgentPaymentInput = {
  item?: string;
  amount_pence: number;
  currency: "GBP" | "USD";
  payee: string;
  category: string;
  what_for: string;
  page_text: string;
};

export type AgentStatus = "paid" | "waiting_for_human" | "blocked" | "protected" | "denied" | "failed" | "in_progress" | "unknown";
export type AgentReply = { status: AgentStatus; message: string; payment_id?: string };

function reply(p: Payment, spotter: string): AgentReply {
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
  return reply(payment, spender.spotter_name);
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
