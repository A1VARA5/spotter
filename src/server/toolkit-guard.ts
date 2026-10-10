// PayPal's Agent Toolkit, with a spotter. An agent written for PayPal's official toolkit (@paypal/agent-toolkit)
// calls the same tool names with the same arguments, but money moving tools never reach PayPal from the agent:
// create_order becomes a Spotter payment request (rules, AI check, hold, the spotter's yes) and pay_order only
// reports what Spotter decided. Read tools pass through to PayPal, only for orders this agent made.
// See docs/agent-toolkit-notes.md for which toolkit tools are guarded, passed through or hidden, and why.
import { randomBytes } from "node:crypto";
import { getPayment, getSpender, InvalidPaymentError, submitPayment, type Deps, type Payment } from "@/core/lifecycle";
import type { Db } from "@/db";
import { reply, type AgentStatus } from "./agent";

/** create_order's arguments, as PayPal's toolkit defines them (shared/parameters.ts, v1.11.0), plus optional extras. */
export type ToolkitOrderInput = {
  currencyCode: "USD" | "GBP";
  items: Array<{ name: string; quantity: number; description?: string; itemCost: number; taxPercent?: number; itemTotal: number }>;
  discount?: number;
  shippingCost?: number;
  shippingAddress?: Record<string, unknown> | null;
  notes?: string | null;
  returnUrl?: string;
  cancelUrl?: string;
  // Spotter extras. An agent written for the toolkit won't send them, and still works.
  payee?: string;
  category?: string;
  page_text?: string;
};

/** Toolkit tools this guard offers, by how they are handled. Everything else in the toolkit is hidden. */
export const GUARDED_TOOLS = ["create_order", "pay_order"] as const;
export const PASSTHROUGH_TOOLS = ["get_order"] as const;

const STATUS: Record<AgentStatus, string> = {
  paid: "COMPLETED",
  waiting_for_human: "HELD_FOR_APPROVAL",
  blocked: "BLOCKED",
  protected: "NEEDS_PROTECTED_PAYMENT",
  denied: "DENIED",
  failed: "FAILED",
  in_progress: "CHECKING",
  unknown: "UNKNOWN",
};

const cents = (n: number) => Math.round(n * 100);
const money = (minor: number, currency: string) => ({ currency_code: currency, value: (minor / 100).toFixed(2) });

/**
 * The order total in pence or cents, worked out the way the toolkit does (items + tax + shipping - discount).
 * The agent's own itemTotal is never trusted: a mismatch is only noted for the checker. Throws on nonsense.
 */
export function orderTotal(input: ToolkitOrderInput): { amount: number; notes: string[] } {
  const bad = (m: string) => {
    throw new InvalidPaymentError(m);
  };
  if (!input.items.length) bad("An order needs at least one item.");
  const notes: string[] = [];
  let total = 0;
  for (const it of input.items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 1000) bad(`Quantity for "${it.name}" must be a whole number from 1 to 1000.`);
    if (!Number.isFinite(it.itemCost) || it.itemCost <= 0 || it.itemCost > 1_000_000) bad(`Price for "${it.name}" must be above zero.`);
    const tax = it.taxPercent ?? 0;
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) bad(`Tax for "${it.name}" must be 0 to 100 percent.`);
    const line = cents(it.itemCost) * it.quantity + Math.round((cents(it.itemCost) * tax * it.quantity) / 100);
    if (Number.isFinite(it.itemTotal) && Math.abs(cents(it.itemTotal) - line) > 1) {
      notes.push(`The agent said itemTotal ${it.itemTotal} for "${it.name}", but ${it.quantity} x ${it.itemCost} plus tax is ${(line / 100).toFixed(2)}.`);
    }
    total += line;
  }
  const shipping = input.shippingCost ?? 0;
  const discount = input.discount ?? 0;
  if (!Number.isFinite(shipping) || shipping < 0) bad("Shipping can't be negative.");
  if (!Number.isFinite(discount) || discount < 0) bad("Discount can't be negative.");
  total += cents(shipping) - cents(discount);
  if (total <= 0) bad("The discount is bigger than the order.");
  return { amount: total, notes };
}

/** Spotter's payment ids ("pay_" + base36 + hex) as an id that fits the toolkit's order id pattern ^[A-Z0-9]{17,32}$. */
export const toToolkitId = (paymentId: string) => paymentId.replace("_", "").toUpperCase();

/** The agent's own payment for an id it was given: Spotter's id or PayPal's order id. Never another agent's. */
async function ownPayment(db: Db, agentId: string, id: string): Promise<Payment | null> {
  if (/^PAY[A-Z0-9]+$/.test(id)) {
    const p = await getPayment(db, `pay_${id.slice(3).toLowerCase()}`);
    if (p && p.spender_id === agentId) return p;
  }
  const rows = await db.query<Payment>("select * from payments where paypal_order_id = $1 and spender_id = $2", [id, agentId]);
  return rows[0] ?? null;
}

async function describe(deps: Deps, agentId: string, p: Payment) {
  const spender = await getSpender(deps.db, agentId);
  const r = reply(p, spender?.spotter_name ?? "Your spotter");
  return {
    id: toToolkitId(p.id),
    status: STATUS[r.status],
    amount: money(Number(p.amount), p.currency),
    ...(p.paypal_order_id ? { paypal_order_id: p.paypal_order_id } : {}),
    spotter: { status: r.status, payment_id: p.id, message: r.message.replace("payment_status", "get_order") },
  };
}

const err = (message: string) => JSON.stringify({ error: { message, type: "spotter_error" } });

export async function toolkitCreateOrder(deps: Deps, agentId: string, input: ToolkitOrderInput): Promise<string> {
  const spender = await getSpender(deps.db, agentId);
  if (!spender) return err("This agent isn't set up in Spotter any more. Ask the user to reconnect it.");
  let total;
  try {
    total = orderTotal(input);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
  // No named shop means nobody can check who gets paid. A fresh name every time keeps it "new", so it is always held.
  const payee = input.payee?.trim() || `a shop the agent didn't name (ref ${randomBytes(3).toString("hex")})`;
  const items = input.items.map((i) => `${i.quantity} x ${i.name} at ${i.itemCost}${i.description ? ` (${i.description})` : ""}`);
  const context = [
    "This order came through PayPal's Agent Toolkit tools (create_order). Everything below is the agent's own words or what it saw, untrusted.",
    `Items: ${items.join("; ")}`,
    input.shippingCost ? `Shipping: ${input.shippingCost}` : "",
    input.discount ? `Discount: ${input.discount}` : "",
    input.payee?.trim() ? "" : "The agent didn't say which shop this is.",
    ...total.notes,
    input.notes ? `What the agent says this is for: ${input.notes}` : "",
    input.page_text ? `The page it is buying from:\n${input.page_text}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const p = await submitPayment(deps, {
      spenderId: agentId,
      money: { amount: total.amount, currency: input.currencyCode },
      payee: { name: payee.slice(0, 120), isNew: true },
      category: input.category?.trim() || "shopping",
      method: "paypal_order",
      item: input.items.map((i) => i.name).join(", ").slice(0, 200),
      context,
    });
    return JSON.stringify(await describe(deps, agentId, p));
  } catch (e) {
    if (e instanceof InvalidPaymentError) return err(e.message);
    throw e;
  }
}

/** pay_order never captures. Capturing a held payment is the spotter's call, never the agent's. */
export async function toolkitPayOrder(deps: Deps, agentId: string, id: string): Promise<string> {
  const p = await ownPayment(deps.db, agentId, id);
  if (!p) return err("No order with that id for this agent.");
  const d = await describe(deps, agentId, p);
  const note =
    d.status === "COMPLETED"
      ? "Spotter already paid this order. Nothing more to do."
      : "Spotter decides when this order is paid; pay_order can't capture it. Tell the user, then check again with get_order.";
  return JSON.stringify({ ...d, spotter: { ...d.spotter, message: `${d.spotter.message} ${note}` } });
}

/** Reads an order at PayPal (the toolkit's own get_order) for an id PayPal knows. Returns the toolkit's JSON string. */
export type OrderReader = (paypalOrderId: string) => Promise<string>;

export async function toolkitGetOrder(deps: Deps, agentId: string, id: string, read: OrderReader): Promise<string> {
  const p = await ownPayment(deps.db, agentId, id);
  if (!p) return err("No order with that id for this agent.");
  const d = await describe(deps, agentId, p);
  if (!p.paypal_order_id) return JSON.stringify({ ...d, paypal: null });
  let paypal: unknown;
  try {
    paypal = JSON.parse(await read(p.paypal_order_id));
  } catch (e) {
    paypal = { error: { message: `Couldn't read the order from PayPal: ${e instanceof Error ? e.message : String(e)}` } };
  }
  return JSON.stringify({ ...d, paypal });
}
