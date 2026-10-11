// Subscriptions, tail first. PayPal's toolkit lets an agent start a subscription with create_subscription. PayPal itself
// keeps a new subscription in APPROVAL_PENDING until the subscriber approves it at PayPal's link, so Spotter uses that:
// it reads the plan (the toolkit's show_subscription_plan_details), works out the whole tail (what is charged now, the
// next charge, then every month, and the first year's total), starts the subscription through the toolkit, and keeps
// the approval link for the spotter. The agent never sees it. Only the spotter's PIN brings it out.
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import type { Deps } from "./lifecycle";
import { getSpender } from "./lifecycle";
import { formatMoney, type Currency } from "./types";
import { sendWarning } from "./switchedoff";
import { findCutUp, type CutUp } from "./cutup";
import { readRun, type Run } from "./selling";

export type Tail = {
  currency: string;
  /** Charged when the subscription is approved: the setup fee plus the first cycle. */
  now: number;
  /** The first charge after today, when there is one in the first year. */
  next: { inDays: number; amount: number } | null;
  /** The cycle that repeats at the end. forever when PayPal's total_cycles is 0. */
  then: { amount: number; every: string; forever: boolean; cycles: number } | null;
  firstYear: number;
};

const MONEY = /^\d{1,7}(\.\d{1,2})?$/;
const minor = (v: unknown): number => {
  if (typeof v !== "string" || !MONEY.test(v)) throw new Error("The plan has a price Spotter can't read.");
  return Math.round(Number(v) * 100);
};
const UNITS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
type Unit = (typeof UNITS)[number];

function step(d: Date, unit: Unit, n: number): Date {
  const x = new Date(d);
  if (unit === "DAY") x.setUTCDate(x.getUTCDate() + n);
  else if (unit === "WEEK") x.setUTCDate(x.getUTCDate() + 7 * n);
  else if (unit === "MONTH") x.setUTCMonth(x.getUTCMonth() + n);
  else x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
}

/** The whole tail of a PayPal plan (billing_cycles and setup_fee), in minor units. Throws on a plan it can't read. */
export function subscriptionTail(plan: any, quantity = 1, start = new Date()): Tail {
  const cycles = (Array.isArray(plan?.billing_cycles) ? [...plan.billing_cycles] : []).sort((a: any, b: any) => Number(a?.sequence) - Number(b?.sequence));
  if (!cycles.length) throw new Error("The plan has no billing cycles.");
  const qty = Number.isInteger(quantity) && quantity > 0 && quantity <= 1000 ? quantity : 1;
  const end = step(start, "YEAR", 1);
  const day = (d: Date) => Math.round((d.getTime() - start.getTime()) / 86_400_000);
  let currency: string | null = null;
  const charges: Array<{ day: number; amount: number }> = [];
  const setup = plan?.payment_preferences?.setup_fee;
  if (setup?.value !== undefined && minor(setup.value) > 0) {
    charges.push({ day: 0, amount: minor(setup.value) });
    currency = setup.currency_code;
  }
  let cursor = start;
  let last: Tail["then"] = null;
  for (const c of cycles) {
    const unit = c?.frequency?.interval_unit as Unit;
    const count = Number(c?.frequency?.interval_count);
    if (!UNITS.includes(unit) || !Number.isInteger(count) || count < 1) throw new Error("The plan has a billing cycle Spotter can't read.");
    const price = c?.pricing_scheme?.fixed_price;
    const amount = minor(price?.value) * qty;
    currency ??= price?.currency_code;
    if (price?.currency_code !== currency) throw new Error("The plan mixes currencies.");
    const total = Number(c?.total_cycles ?? 0);
    const forever = total === 0;
    if (!Number.isInteger(total) || total < 0 || (forever && c?.tenure_type === "TRIAL")) throw new Error("The plan has a billing cycle Spotter can't read.");
    for (let i = 0; forever || i < total; i++) {
      if (cursor >= end) break;
      charges.push({ day: day(cursor), amount });
      cursor = step(cursor, unit, count);
    }
    last = { amount, every: count === 1 ? unit.toLowerCase() : `${count} ${unit.toLowerCase()}s`, forever, cycles: total };
    if (cursor >= end) break;
  }
  const after = charges.filter((c) => c.day > 0 && c.amount > 0);
  return {
    currency: currency ?? "USD",
    now: charges.filter((c) => c.day === 0).reduce((s, c) => s + c.amount, 0),
    next: after[0] ? { inDays: after[0].day, amount: after[0].amount } : null,
    then: last,
    firstYear: charges.reduce((s, c) => s + c.amount, 0),
  };
}

const fmt = (amount: number, currency: string) => formatMoney({ amount, currency: currency as Currency });

/** "£0.00 now, £39.99 in 7 days, then £39.99 every month until cancelled. £479.88 in the first year." */
export function tailText(t: Tail): string {
  const parts = [`${fmt(t.now, t.currency)} now`];
  if (t.next) parts.push(`${fmt(t.next.amount, t.currency)} in ${t.next.inDays} ${t.next.inDays === 1 ? "day" : "days"}`);
  const then = t.then ? `, then ${fmt(t.then.amount, t.currency)} every ${t.then.every}${t.then.forever ? " until cancelled" : `, ${t.then.cycles} times in all`}` : "";
  return `${parts.join(", ")}${then}. ${fmt(t.firstYear, t.currency)} in the first year.`;
}

const cutUpLine = (c: CutUp, t: Tail) =>
  `The same money cut up? ${fmt(c.held, c.currency)} to ${c.payee} was ${c.status === "needs_approval" ? "held" : "stopped"} earlier today, and now this agent wants a subscription to ${c.payee}: ${fmt(t.firstYear, t.currency)} over the first year.`;

const err = (message: string) => JSON.stringify({ error: { message, type: "spotter_error" } });

/** create_subscription's own arguments (toolkit 1.11.0) plus Spotter's optional payee. */
export type SubscriptionArgs = { plan_id: string; quantity?: number; payee?: string } & Record<string, unknown>;

export async function holdSubscription(deps: Deps, run: Run, agentId: string, args: SubscriptionArgs): Promise<string> {
  const { db } = deps;
  const agent = await getSpender(db, agentId);
  if (!agent) return err("This agent isn't set up in Spotter any more. Ask the user to reconnect it.");
  if (agent.frozen_at) return err(`Spotter paused this agent, so nothing it asks for goes through. Only ${agent.spotter_name} can unpause it.`);
  const planRead = readRun(await run("show_subscription_plan_details", { plan_id: args.plan_id }));
  if (!planRead.ok) return err(`Spotter couldn't read that plan from PayPal (${planRead.message}), so no subscription was started.`);
  let tail: Tail;
  try {
    tail = subscriptionTail(planRead.data, typeof args.quantity === "number" ? args.quantity : 1);
  } catch (e) {
    return err(`${e instanceof Error ? e.message : String(e)} No subscription was started.`);
  }
  const planName = String(planRead.data?.name ?? args.plan_id).slice(0, 120);
  const payee = (typeof args.payee === "string" && args.payee.trim()) || planName;
  const cutUp = await findCutUp(db, agentId, payee);

  // Only the toolkit's own arguments go to PayPal.
  const { payee: _payee, ...official } = args;
  void _payee;
  const created = readRun(await run("create_subscription", official));
  if (!created.ok || typeof created.data?.id !== "string") return err(`PayPal didn't start the subscription (${created.ok ? "no id" : created.message}). Nothing will be charged.`);
  const links: Array<{ rel?: string; href?: string }> = Array.isArray(created.data.links) ? created.data.links : [];
  const approve = links.find((l) => l.rel === "approve" && typeof l.href === "string" && l.href.startsWith("https://"))?.href ?? null;
  if (!approve) {
    console.error(`[spotter] subscription ${created.data.id}: PayPal gave no approval link`);
    return err("PayPal started the subscription but gave no approval link, so it can never be approved and nothing will be charged. Tell the user to try again later.");
  }
  const id = `sub_${randomBytes(8).toString("hex")}`;
  await db.query(
    "insert into held_subscriptions (id, household_id, spender_id, plan_id, plan_name, payee, paypal_subscription_id, approve_url, tail, cut_up, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'held')",
    [id, agent.household_id, agentId, String(args.plan_id).slice(0, 64), planName, payee.slice(0, 120), created.data.id.slice(0, 64), approve, JSON.stringify(tail), cutUp ? JSON.stringify(cutUp) : null],
  );
  const text = `${agent.name} wants to start "${planName}": ${tailText(tail)}${cutUp ? ` ${cutUpLine(cutUp, tail)}` : ""} Nothing is charged until you approve it with your PIN.`;
  await sendWarning(deps, agent.household_id, { kind: "subscription_held", text });
  return JSON.stringify({
    id: created.data.id,
    status: String(created.data.status ?? "APPROVAL_PENDING"),
    spotter: {
      status: "waiting_for_human",
      message:
        `Spotter is holding this subscription for ${agent.spotter_name}: ${tailText(tail)} ` +
        (cutUp ? `Spotter thinks this may be the same money cut up: ${fmt(cutUp.held, cutUp.currency)} to ${cutUp.payee} was already held or stopped today. ` : "") +
        `Only ${agent.spotter_name} gets the approval link. Tell the user it is waiting for ${agent.spotter_name}.`,
    },
  });
}

/** Strips every link from PayPal's answer: the approve link is the spotter's alone. */
function withoutLinks(raw: string): string {
  const r = readRun(raw);
  if (!r.ok || !r.data || typeof r.data !== "object") return raw.includes("http") ? err("PayPal's answer couldn't be shown safely.") : raw;
  const { links: _links, ...rest } = r.data as Record<string, unknown>;
  void _links;
  return JSON.stringify(rest);
}

export async function scopedShowSubscription(deps: Deps, run: Run, agentId: string, subscriptionId: string): Promise<string> {
  const [mine] = await deps.db.query("select 1 from held_subscriptions where paypal_subscription_id = $1 and spender_id = $2", [subscriptionId, agentId]);
  if (!mine) return err("Spotter only shows subscriptions you started through Spotter.");
  return withoutLinks(await run("show_subscription_details", { subscription_id: subscriptionId }));
}

export type HeldSubscription = {
  id: string;
  spender_id: string | null;
  agent: string | null;
  plan_name: string;
  payee: string;
  paypal_subscription_id: string;
  tail: Tail;
  tail_text: string;
  cut_up: CutUp | null;
  status: "held" | "released" | "denied";
  decided_by: string | null;
  created_at: string;
};

/** For the spotter's page. Never the approval link: that comes only from decideSubscription. */
export async function listHeldSubscriptions(db: Db, householdId: string, limit = 20): Promise<HeldSubscription[]> {
  const rows = await db.query<any>(
    `select h.id, h.spender_id, s.name as agent, h.plan_name, h.payee, h.paypal_subscription_id, h.tail, h.cut_up, h.status, h.decided_by, h.created_at
     from held_subscriptions h left join spenders s on s.id = h.spender_id where h.household_id = $1 order by h.created_at desc limit $2`,
    [householdId, limit],
  );
  return rows.map((r) => ({ ...r, tail_text: tailText(r.tail), created_at: new Date(r.created_at).toISOString() }));
}

/** The spotter's answer (the caller checked the PIN). Approve hands the spotter PayPal's approval link, once. */
export async function decideSubscription(db: Db, householdId: string, id: string, action: "approve" | "deny", by: string): Promise<{ ok: boolean; message: string; approveUrl?: string }> {
  if (action === "deny") {
    const rows = await db.query("update held_subscriptions set status = 'denied', approve_url = null, decided_by = $3, decided_at = now() where id = $1 and household_id = $2 and status = 'held' returning id", [id, householdId, by]);
    return rows.length ? { ok: true, message: "Turned down. PayPal never charges a subscription nobody approved." } : { ok: false, message: "That subscription isn't waiting any more." };
  }
  const [row] = await db.query<{ approve_url: string | null }>(
    "update held_subscriptions set status = 'released', decided_by = $3, decided_at = now() where id = $1 and household_id = $2 and status = 'held' and approve_url is not null returning approve_url",
    [id, householdId, by],
  );
  if (!row) return { ok: false, message: "That subscription isn't waiting any more." };
  if (!row.approve_url) return { ok: false, message: "PayPal didn't give an approval link for this one, so there's nothing to approve." };
  return { ok: true, message: "Approve it at PayPal to start it. Nothing is charged until you do.", approveUrl: row.approve_url };
}
