// Guarding the family's selling agent. PayPal's Agent Toolkit is a seller's toolkit, and families sell too: a teen
// reselling trainers on a parent's PayPal (PayPal accounts are 18+, so the parent holds the account and is the spotter),
// or a small business. The risk flips: the scam is getting the seller to send money back or post goods unpaid.
//   create_refund            never runs from the agent. It becomes a held refund request: only to the original payment
//                            (a capture Spotter took for this family), checked against what PayPal says the buyer paid,
//                            and run with the toolkit's own create_refund only after the spotter's PIN.
//   create_shipment_tracking "Paid? Prove it": refused until PayPal itself shows a completed capture for that sale.
//   create_order / pay_order the agent's own sales, through the toolkit, recorded as this family's (money only comes in).
// Every family shares Spotter's one sandbox merchant, so everything is scoped to the sales table: an agent can only
// see or touch orders Spotter made for its own household, never list the account.
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import { getSpender, type Deps, type Spender } from "./lifecycle";
import { formatMoney, type Currency } from "./types";
import { sendWarning } from "./switchedoff";
import { orderTotal, type ToolkitOrderInput } from "@/server/toolkit-guard";

/** The toolkit's own call (PayPalAPI.run): a JSON string, errors as {"error":{...}} rather than thrown. */
export type Run = (method: string, args: Record<string, unknown>, opts?: { requestId?: string }) => Promise<string>;

const err = (message: string) => JSON.stringify({ error: { message, type: "spotter_error" } });
const MONEY = /^\d{1,7}(\.\d{1,2})?$/;
const toMinor = (v: unknown): number | null => (typeof v === "string" && MONEY.test(v) ? Math.round(Number(v) * 100) : null);
const decimal = (minor: number) => (minor / 100).toFixed(2);
const fmt = (amount: number, currency: string) => formatMoney({ amount, currency: currency as Currency });

/** Reads the toolkit's answer. ok false carries PayPal's (or the toolkit's) words. */
/** Reads the toolkit's answer. ok false carries PayPal's (or the toolkit's) words; noAnswer means PayPal never replied,
 * so whatever was asked may or may not have happened. The toolkit sends errors two ways: {"error":{...}} for its own
 * failures, and an LlmError ({"ok":false,"code":"PAYPAL_API_HTTP_ERROR" or "PAYPAL_API_NO_RESPONSE",...}) for PayPal's. */
export function readRun(raw: string): { ok: true; data: any } | { ok: false; message: string; noAnswer: boolean } {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, message: `PayPal's answer wasn't readable: ${raw.slice(0, 120)}`, noAnswer: false };
  }
  if (data && typeof data === "object" && data.error) return { ok: false, message: String(data.error.message ?? "PayPal refused it").slice(0, 300), noAnswer: false };
  if (data && typeof data === "object" && data.ok === false) {
    return { ok: false, message: String(data.message ?? data.code ?? "PayPal refused it").slice(0, 300), noAnswer: data.code === "PAYPAL_API_NO_RESPONSE" };
  }
  return { ok: true, data };
}

async function callRun(run: Run, method: string, args: Record<string, unknown>, opts?: { requestId?: string }) {
  try {
    return readRun(await (opts ? run(method, args, opts) : run(method, args)));
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e), noAnswer: true };
  }
}

export type Sale = {
  id: string;
  household_id: string;
  spender_id: string | null;
  paypal_order_id: string;
  capture_id: string | null;
  amount: string | number;
  currency: string;
  item: string;
  example: boolean;
};

export async function recordSale(
  db: Db,
  s: { householdId: string; spenderId: string | null; orderId: string; captureId: string | null; amount: number; currency: Currency; item: string; example: boolean },
): Promise<string> {
  const id = `sale_${randomBytes(8).toString("hex")}`;
  await db.query(
    "insert into sales (id, household_id, spender_id, paypal_order_id, capture_id, amount, currency, item, example) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, s.householdId, s.spenderId, s.orderId, s.captureId, s.amount, s.currency, s.item.slice(0, 200), s.example],
  );
  return id;
}

/** The agent, if it may act: exists and isn't paused. Otherwise the error to send back. */
async function activeAgent(db: Db, agentId: string): Promise<Spender | string> {
  const spender = await getSpender(db, agentId);
  if (!spender) return err("This agent isn't set up in Spotter any more. Ask the user to reconnect it.");
  if (spender.frozen_at) return err(`Spotter paused this agent, so nothing it asks for goes through. Only ${spender.spotter_name} can unpause it.`);
  return spender;
}

const saleBy = async (db: Db, householdId: string, col: "capture_id" | "paypal_order_id", id: string) =>
  (await db.query<Sale>(`select * from sales where ${col} = $1 and household_id = $2`, [id, householdId]))[0] ?? null;

/** What PayPal's order says about one capture: its status, what the buyer paid, and what was refunded already. */
export function captureFacts(order: any, captureId: string): { status: string; paid: number; currency: string; refunded: number } | null {
  for (const unit of Array.isArray(order?.purchase_units) ? order.purchase_units : []) {
    const capture = (unit?.payments?.captures ?? []).find((c: any) => c?.id === captureId);
    if (!capture) continue;
    const paid = toMinor(capture.amount?.value);
    if (paid === null || typeof capture.amount?.currency_code !== "string") return null;
    const refunds = (unit.payments.refunds ?? []).filter((r: any) => r?.status === "COMPLETED" || r?.status === "PENDING");
    const amounts = refunds.map((r: any) => toMinor(r.amount?.value));
    // A refund Spotter can't read could be anything: better to stop than to undercount and refund twice.
    if (amounts.some((a: number | null) => a === null)) return null;
    const refunded = amounts.reduce((sum: number, a: number) => sum + a, 0);
    return { status: String(capture.status ?? ""), paid, currency: capture.amount.currency_code, refunded };
  }
  return null;
}

async function paypalCapture(run: Run, sale: Sale, captureId: string) {
  const r = await callRun(run, "get_order", { id: sale.paypal_order_id });
  if (!r.ok) return { error: `Spotter couldn't reach PayPal to check the payment (${r.message}), so nothing was done. Try again in a minute.`, outage: true };
  const facts = captureFacts(r.data, captureId);
  if (!facts) return { error: "PayPal doesn't show that payment on this sale, so nothing was done." };
  return { facts };
}

/** Refunds Spotter already sent or is sending for this sale, in case PayPal's order view lags behind. */
async function refundedHere(db: Db, saleId: string, exceptId?: string): Promise<number> {
  const [r] = await db.query<{ total: string | null }>(
    "select sum(amount)::text as total from refund_requests where sale_id = $1 and status in ('refunding', 'refunded') and id <> coalesce($2, '')",
    [saleId, exceptId ?? null],
  );
  return Number(r?.total ?? 0);
}

export const overpaymentLine = (paid: number, asked: number, currency: string) =>
  `They paid ${fmt(paid, currency)}. They're asking for ${fmt(asked, currency)} back. This is how the overpayment scam works.`;

export type RefundArgs = { capture_id: string; amount?: { currency_code: string; value: string }; invoice_id?: string; note_to_payer?: string };

/** create_refund from a selling agent: a held request, never a refund. Checked against PayPal's real numbers. */
export async function requestRefund(deps: Deps, run: Run, agentId: string, args: RefundArgs): Promise<string> {
  const { db } = deps;
  const agent = await activeAgent(db, agentId);
  if (typeof agent === "string") return agent;
  const sale = await saleBy(db, agent.household_id, "capture_id", args.capture_id);
  // Only back to a payment Spotter took for this family. A refund can never go to anyone new: it can only name a capture.
  if (!sale) return err("Spotter can only refund a payment Spotter took for this family. That capture isn't one of them, so nothing was refunded.");
  const read = await paypalCapture(run, sale, args.capture_id);
  if ("error" in read) return err(read.error!);
  const { facts } = read;
  if (args.amount && args.amount.currency_code !== facts.currency) return err(`The buyer paid in ${facts.currency}, so a refund has to be in ${facts.currency}. Nothing was refunded.`);
  const left = facts.paid - Math.max(facts.refunded, await refundedHere(db, sale.id));
  const asked = args.amount ? toMinor(args.amount.value) : left;
  if (asked === null || asked <= 0) return err("That refund amount isn't a valid amount. Nothing was refunded.");

  const id = `rfd_${randomBytes(8).toString("hex")}`;
  const over = asked > left;
  const reason = over
    ? left < facts.paid
      ? `${overpaymentLine(facts.paid, asked, facts.currency)} ${fmt(facts.paid - left, facts.currency)} was already refunded.`
      : overpaymentLine(facts.paid, asked, facts.currency)
    : null;
  await db.query(
    "insert into refund_requests (id, household_id, spender_id, sale_id, amount, currency, paid, note, status, reason) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [id, agent.household_id, agentId, sale.id, asked, facts.currency, facts.paid, args.note_to_payer?.slice(0, 500) ?? null, over ? "refused" : "held", reason],
  );
  const text = over
    ? `${agent.name} asked to refund ${fmt(asked, facts.currency)} for "${sale.item}". ${reason} Spotter refused it and nothing was sent.`
    : `${agent.name} wants to refund ${fmt(asked, facts.currency)} of the ${fmt(facts.paid, facts.currency)} paid for "${sale.item}". It goes back to the original payment only. Open Spotter and approve it with your PIN if it's right.`;
  await sendWarning(deps, agent.household_id, { kind: "refund_held", text });
  if (over) {
    return JSON.stringify({
      status: "REFUSED",
      refund_request_id: id,
      spotter: { status: "refused", message: `Spotter refused this refund: the buyer paid ${fmt(facts.paid, facts.currency)} and ${fmt(Math.max(left, 0), facts.currency)} is left to refund. ${agent.spotter_name} has been told. Nothing was sent.` },
    });
  }
  return JSON.stringify({
    status: "HELD_FOR_APPROVAL",
    refund_request_id: id,
    spotter: {
      status: "waiting_for_human",
      message: `Spotter is holding this refund for ${agent.spotter_name}. Nothing has been refunded yet. If ${agent.spotter_name} approves, it goes back to the original payment.`,
    },
  });
}

export type RefundRequest = {
  id: string;
  spender_id: string | null;
  agent: string | null;
  item: string;
  amount: number;
  paid: number;
  currency: string;
  note: string | null;
  status: "held" | "refused" | "refunding" | "refunded" | "denied" | "failed";
  reason: string | null;
  paypal_refund_id: string | null;
  error: string | null;
  decided_by: string | null;
  example: boolean;
  confirmed_at: string | null;
  created_at: string;
};

export async function listRefunds(db: Db, householdId: string, limit = 20): Promise<RefundRequest[]> {
  const rows = await db.query<any>(
    `select r.*, s.name as agent, sa.item, sa.example from refund_requests r join sales sa on sa.id = r.sale_id
     left join spenders s on s.id = r.spender_id where r.household_id = $1 order by r.created_at desc limit $2`,
    [householdId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    spender_id: r.spender_id,
    agent: r.agent,
    item: r.item,
    amount: Number(r.amount),
    paid: Number(r.paid),
    currency: r.currency,
    note: r.note,
    status: r.status,
    reason: r.reason,
    paypal_refund_id: r.paypal_refund_id,
    error: r.error,
    decided_by: r.decided_by,
    example: r.example,
    confirmed_at: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

/** The spotter's answer (the caller checked the PIN). Approve runs the toolkit's create_refund on the original capture. */
export async function decideRefund(deps: Deps, run: Run, householdId: string, id: string, action: "approve" | "deny", by: string): Promise<{ ok: boolean; message: string }> {
  const { db } = deps;
  if (action === "deny") {
    const rows = await db.query("update refund_requests set status = 'denied', decided_by = $3, decided_at = now() where id = $1 and household_id = $2 and status = 'held' returning id", [id, householdId, by]);
    return rows.length ? { ok: true, message: "Refund turned down. Nothing was sent." } : { ok: false, message: "That refund isn't waiting any more." };
  }
  // One conditional update claims it, so a double tap can't refund twice.
  const [req] = await db.query<{ sale_id: string; amount: string; currency: string; note: string | null }>(
    "update refund_requests set status = 'refunding', decided_by = $3, decided_at = now() where id = $1 and household_id = $2 and status = 'held' returning sale_id, amount, currency, note",
    [id, householdId, by],
  );
  if (!req) return { ok: false, message: "That refund isn't waiting any more." };
  const failWith = async (message: string, status: "failed" | "held" = "failed") => {
    await db.query("update refund_requests set status = $2, error = $3 where id = $1", [id, status, message]);
    console.error(`[spotter] refund ${id} not sent: ${message}`);
    return { ok: false, message };
  };
  const [sale] = await db.query<Sale>("select * from sales where id = $1 and household_id = $2", [req.sale_id, householdId]);
  if (!sale?.capture_id) return failWith("The sale behind this refund has no PayPal payment, so nothing was sent.");
  const amount = Number(req.amount);
  // PayPal's numbers again, right now: a refund made in the meantime must not be paid twice.
  const read = await paypalCapture(run, sale, sale.capture_id);
  if ("error" in read) return failWith(read.error!);
  const left = read.facts.paid - Math.max(read.facts.refunded, await refundedHere(db, sale.id, id));
  if (amount > left) return failWith(`PayPal now shows only ${fmt(Math.max(left, 0), read.facts.currency)} left to refund, so nothing was sent.`);

  const r = await callRun(run, "create_refund", {
    capture_id: sale.capture_id,
    amount: { currency_code: req.currency, value: decimal(amount) },
    ...(req.note ? { note_to_payer: req.note } : {}),
  }, { requestId: `refund-${id}` }); // the same refund request is one refund at PayPal, even if sent again
  if (!r.ok && r.noAnswer) {
    // PayPal may have refunded it: it stays "refunding" (shown as "check PayPal") so nobody sends it again blind.
    await db.query("update refund_requests set error = $2 where id = $1", [id, `PayPal didn't answer: ${r.message}`]);
    console.error(`[spotter] refund ${id}: PayPal didn't answer (${r.message}); left as refunding, check PayPal`);
    return { ok: false, message: "PayPal didn't answer, so Spotter can't tell if the refund went through. Check PayPal before trying again." };
  }
  if (!r.ok) return failWith(`PayPal refused the refund: ${r.message}`);
  const refundId = typeof r.data?.id === "string" ? r.data.id.slice(0, 64) : null;
  const paypalStatus = String(r.data?.status ?? "");
  if (!refundId || (paypalStatus !== "COMPLETED" && paypalStatus !== "PENDING")) {
    return failWith(`PayPal answered the refund with status ${paypalStatus || "none"}${refundId ? ` (refund ${refundId})` : " and no refund id"}, so it isn't counted as sent. Check PayPal.`);
  }
  await db.query("update refund_requests set status = 'refunded', paypal_refund_id = $2, paypal_status = $3, error = null where id = $1", [id, refundId, paypalStatus.slice(0, 32)]);
  return { ok: true, message: `Refunded ${fmt(amount, req.currency)} to the original payment. PayPal will confirm it.` };
}

/** PAYMENT.CAPTURE.REFUNDED for a refund Spotter sent. True if it was one of ours. */
export async function refundConfirmed(db: Db, refundId: string): Promise<boolean> {
  const rows = await db.query("update refund_requests set confirmed_at = coalesce(confirmed_at, now()) where paypal_refund_id = $1 returning id", [refundId]);
  return rows.length > 0;
}

/** get_refund, only for a refund Spotter made for this agent's family. */
export async function scopedGetRefund(deps: Deps, run: Run, agentId: string, refundId: string): Promise<string> {
  const agent = await activeAgent(deps.db, agentId);
  if (typeof agent === "string") return agent;
  const [mine] = await deps.db.query("select 1 from refund_requests where paypal_refund_id = $1 and household_id = $2", [refundId, agent.household_id]);
  if (!mine) return err("Spotter only shows refunds it made for this family. That isn't one of them.");
  return run("get_refund", { refund_id: refundId });
}

export type ShipmentArgs = { order_id?: string; tracking_number: string; transaction_id: string; status?: string; carrier?: string };

/** create_shipment_tracking: "Paid? Prove it". Only for this family's sale, and only once PayPal shows it paid. */
export async function guardShipment(deps: Deps, run: Run, agentId: string, args: ShipmentArgs): Promise<string> {
  const { db } = deps;
  const agent = await activeAgent(db, agentId);
  if (typeof agent === "string") return agent;
  const sale = args.order_id ? await saleBy(db, agent.household_id, "paypal_order_id", args.order_id) : await saleBy(db, agent.household_id, "capture_id", args.transaction_id);
  if (!sale) return err("Spotter only adds tracking to sales it made for this family. That isn't one of them, so nothing was added.");
  if (sale.capture_id && sale.capture_id !== args.transaction_id) return err("That transaction id isn't this sale's payment, so nothing was added.");
  const read = await paypalCapture(run, sale, args.transaction_id);
  if ("error" in read && read.outage) return err(read.error!);
  if ("error" in read || read.facts.status !== "COMPLETED") {
    return err(
      `Paid? Prove it. PayPal shows no completed payment for "${sale.item}" yet, so Spotter didn't add tracking. ` +
        "An email saying it was paid isn't proof: only PayPal is. Don't post anything until PayPal shows the money.",
    );
  }
  if (!sale.capture_id) await db.query("update sales set capture_id = $2 where id = $1 and capture_id is null", [sale.id, args.transaction_id]);
  return run("create_shipment_tracking", { ...args });
}

/** get_shipment_tracking, only for this family's paid sales. */
export async function scopedGetTracking(deps: Deps, run: Run, agentId: string, args: { transaction_id: string; tracking_number?: string }): Promise<string> {
  const agent = await activeAgent(deps.db, agentId);
  if (typeof agent === "string") return agent;
  if (!(await saleBy(deps.db, agent.household_id, "capture_id", args.transaction_id))) return err("Spotter only shows tracking for this family's own sales.");
  return run("get_shipment_tracking", { ...args });
}

/** create_order from a selling agent: a real toolkit order for the buyer to pay this family, recorded as its sale. */
export async function sellCreateOrder(deps: Deps, run: Run, agentId: string, input: ToolkitOrderInput): Promise<string> {
  const agent = await activeAgent(deps.db, agentId);
  if (typeof agent === "string") return agent;
  if (input.currencyCode !== "USD") return err("PayPal's toolkit only makes orders in US dollars (currencyCode USD).");
  let total;
  try {
    total = orderTotal(input);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
  // Only the toolkit's own arguments go to PayPal; Spotter's extras stay here.
  const { payee: _p, category: _c, page_text: _t, offer_id: _o, ...official } = input;
  void _p, _c, _t, _o;
  const raw = await run("create_order", official as Record<string, unknown>);
  const r = readRun(raw);
  if (!r.ok || typeof r.data?.id !== "string") return raw;
  await recordSale(deps.db, { householdId: agent.household_id, spenderId: agentId, orderId: r.data.id, captureId: null, amount: total.amount, currency: "USD", item: input.items.map((i) => i.name).join(", "), example: false });
  return raw;
}

/** pay_order from a selling agent: takes a buyer's approved payment for this family's own sale. */
export async function sellPayOrder(deps: Deps, run: Run, agentId: string, orderId: string): Promise<string> {
  const agent = await activeAgent(deps.db, agentId);
  if (typeof agent === "string") return agent;
  const sale = await saleBy(deps.db, agent.household_id, "paypal_order_id", orderId);
  if (!sale) return err("Spotter only takes payments for sales it made for this family.");
  const raw = await run("pay_order", { id: orderId }, { requestId: `capture-${sale.id}` });
  const r = readRun(raw);
  const capture = r.ok ? (r.data?.response?.purchase_units?.[0]?.payments?.captures?.[0] as { id?: unknown } | undefined) : undefined;
  if (typeof capture?.id === "string") await deps.db.query("update sales set capture_id = $2 where id = $1", [sale.id, capture.id.slice(0, 64)]);
  else if (r.ok) {
    console.error(`[spotter] pay_order for sale ${sale.id}: PayPal's answer had no capture id, so the sale isn't linked to a payment`);
    return JSON.stringify({ paypal: r.data, spotter: { message: "PayPal answered, but Spotter couldn't find the payment in its answer, so refunds and tracking for this sale won't work yet. Check with get_order." } });
  }
  return raw;
}

/** get_order from a selling agent: only this family's sales. */
export async function sellGetOrder(deps: Deps, run: Run, agentId: string, orderId: string): Promise<string> {
  const agent = await activeAgent(deps.db, agentId);
  if (typeof agent === "string") return agent;
  if (!(await saleBy(deps.db, agent.household_id, "paypal_order_id", orderId))) return err("Spotter only shows sales it made for this family.");
  return run("get_order", { id: orderId });
}
