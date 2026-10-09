// The payment lifecycle: request -> rules -> AI check -> decision -> PayPal hold -> spotter -> capture or void.
// Every status change is a single conditional UPDATE, so double taps and races can't capture twice.
import type { Db } from "@/db";
import type { PaymentStatus } from "@/db/schema";
import type { AiCheckResult } from "@/ai/check";
import type { captureAuthorization, createAuthorizeOrder, voidAuthorization } from "@/paypal/client";
import { checkRules, normName } from "./rules";
import { decide, type Decision } from "./decide";
import type { Allowance, Currency, Money, PaymentMethod, PaymentRequest } from "./types";
import { priceCheck, type MarketResult, type Offer } from "./market";

export type Deps = {
  db: Db;
  check: (req: PaymentRequest) => Promise<AiCheckResult>;
  /** Real retailer offers for an item (Channel3). null means the lookup couldn't run. Optional. */
  market?: (item: string, currency: Currency) => Promise<Offer[] | null>;
  /** Tells the spotter about a payment that needs them or was stopped. Failures are logged, never fatal. */
  notify?: (payment: Payment, spender: Spender) => Promise<void>;
  paypal: {
    createAuthorizeOrder: typeof createAuthorizeOrder;
    captureAuthorization: typeof captureAuthorization;
    voidAuthorization: typeof voidAuthorization;
  };
};

export type SpenderKind = "agent" | "person" | "kid";
export type Spender = {
  id: string;
  household_id: string;
  name: string;
  kind: SpenderKind;
  spotter_name: string;
  email: string | null;
  telegram_chat_id: string | null;
  allowance: Omit<Allowance, "spentThisWeek">;
};
export type NewSpender = { id: string; householdId: string; name: string; kind: SpenderKind; spotterName: string; allowance: Omit<Allowance, "spentThisWeek"> };

export type Payment = {
  id: string;
  spender_id: string;
  request: PaymentRequest;
  decision: Decision | null;
  ai: AiCheckResult | null;
  market: (MarketResult & { item: string }) | null;
  status: PaymentStatus;
  amount: string | number;
  currency: string;
  paypal_order_id: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  approve_url: string | null;
  error: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentInput = {
  spenderId: string;
  money: Money;
  payee: { name: string; id?: string; isNew: boolean };
  category: string;
  method: PaymentMethod;
  context: string;
  item?: string;
};

export class InvalidPaymentError extends Error {
  name = "InvalidPaymentError";
}

const HOLDING: PaymentStatus[] = ["needs_approval", "authorised", "capturing", "captured"];
const newId = () => `pay_${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

async function event(db: Db, paymentId: string, type: string, data: Record<string, unknown> = {}) {
  await db.query("insert into events (payment_id, type, data) values ($1, $2, $3)", [paymentId, type, JSON.stringify(data)]);
}

async function setStatus(db: Db, id: string, status: PaymentStatus, extra: Record<string, unknown> = {}): Promise<Payment> {
  const cols = Object.keys(extra);
  const sets = ["status = $2", "updated_at = now()", ...cols.map((c, i) => `${c} = $${i + 3}`)];
  const rows = await db.query<Payment>(`update payments set ${sets.join(", ")} where id = $1 returning *`, [
    id,
    status,
    ...cols.map((c) => (typeof extra[c] === "object" && extra[c] !== null ? JSON.stringify(extra[c]) : extra[c])),
  ]);
  return rows[0]!;
}

/** Atomically move from one status to another. Returns null if someone else got there first. */
async function transition(db: Db, id: string, from: PaymentStatus, to: PaymentStatus, by?: string): Promise<Payment | null> {
  const rows = await db.query<Payment>(
    "update payments set status = $3, decided_by = coalesce($4, decided_by), updated_at = now() where id = $1 and status = $2 returning *",
    [id, from, to, by ?? null],
  );
  return rows[0] ?? null;
}

export async function createSpender(db: Db, s: NewSpender) {
  await db.query(
    "insert into spenders (id, household_id, name, kind, spotter_name, allowance) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set name = excluded.name, kind = excluded.kind, spotter_name = excluded.spotter_name, allowance = excluded.allowance",
    [s.id, s.householdId, s.name, s.kind, s.spotterName, JSON.stringify(s.allowance)],
  );
}

export async function getSpender(db: Db, id: string): Promise<Spender | null> {
  return (await db.query<Spender>("select * from spenders where id = $1", [id]))[0] ?? null;
}

/** With a household, only finds the payment if it belongs to that household. */
export async function getPayment(db: Db, id: string, householdId?: string): Promise<Payment | null> {
  const rows = householdId
    ? await db.query<Payment>("select p.* from payments p join spenders s on s.id = p.spender_id where p.id = $1 and s.household_id = $2", [id, householdId])
    : await db.query<Payment>("select * from payments where id = $1", [id]);
  return rows[0] ?? null;
}

export async function listPayments(db: Db, householdId: string, limit = 50): Promise<Payment[]> {
  return db.query<Payment>(
    "select p.* from payments p join spenders s on s.id = p.spender_id where s.household_id = $1 order by p.created_at desc limit $2",
    [householdId, limit],
  );
}

export async function listEvents(db: Db, paymentId: string) {
  return db.query<{ type: string; data: unknown; at: string }>("select type, data, at from events where payment_id = $1 order by id", [paymentId]);
}

/** Money already used this week: paid, held, or still being checked, from payments made before this one. */
async function spentThisWeek(db: Db, spenderId: string, currency: string, beforeId: string): Promise<number> {
  const rows = await db.query<{ total: string | null }>(
    `select sum(p.amount)::text as total from payments p, payments me
     where me.id = $4 and p.spender_id = $1 and p.currency = $2 and p.status = any($3)
       and p.created_at > now() - interval '7 days'
       and (p.created_at, p.id) < (me.created_at, me.id)`,
    [spenderId, currency, [...HOLDING, "checking"], beforeId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Everything paid, held or being checked for a spender over the last 7 days. */
export async function weekSpend(db: Db, spenderId: string, currency: string): Promise<number> {
  const rows = await db.query<{ total: string | null }>(
    "select sum(amount)::text as total from payments where spender_id = $1 and currency = $2 and status = any($3) and created_at > now() - interval '7 days'",
    [spenderId, currency, [...HOLDING, "checking"]],
  );
  return Number(rows[0]?.total ?? 0);
}

async function marketCheck(deps: Deps, req: PaymentRequest): Promise<(MarketResult & { item: string }) | null> {
  if (!deps.market || !req.item?.trim()) return null;
  try {
    const offers = await deps.market(req.item, req.money.currency);
    return offers ? { ...priceCheck(req.money.amount, req.money.currency, offers), item: req.item } : null;
  } catch (e) {
    console.error(`[spotter] market check failed for ${req.id}:`, e instanceof Error ? e.message : e);
    return null; // a missing price check never blocks or approves anything on its own
  }
}

/** A payee is new unless this spender has paid or is paying them already. Never trusted from the caller. */
async function isNewPayee(db: Db, spenderId: string, payee: string, beforeId: string): Promise<boolean> {
  const rows = await db.query<{ request: PaymentRequest }>(
    "select request from payments where spender_id = $1 and id <> $2 and status = any($3)",
    [spenderId, beforeId, HOLDING],
  );
  return !rows.some((r) => normName(r.request.payee.name) === normName(payee));
}

const errText = (e: unknown) => {
  if (!(e instanceof Error)) return String(e);
  const extra = e as Error & { issue?: unknown; debugId?: unknown };
  return [e.message, extra.issue ? `(${String(extra.issue)})` : "", extra.debugId ? `[PayPal debug ${String(extra.debugId)}]` : ""]
    .filter(Boolean)
    .join(" ");
};

/** Record a failure on a payment. Never throws: the original error matters more than a logging hiccup. */
async function fail(db: Db, id: string, step: string, e: unknown, extra: Record<string, unknown> = {}): Promise<Payment> {
  const error = errText(e);
  console.error(`[spotter] payment ${id} failed at ${step}: ${error}`);
  await event(db, id, "failed", { step, error }).catch(() => {});
  return setStatus(db, id, "failed", { ...extra, error });
}

export async function submitPayment(deps: Deps, input: PaymentInput): Promise<Payment> {
  const { db } = deps;
  const spender = await getSpender(db, input.spenderId);
  if (!spender) throw new Error(`Unknown spender ${input.spenderId}`);

  if (!Number.isInteger(input.money.amount) || input.money.amount <= 0) {
    throw new InvalidPaymentError("Amount must be a whole number of pence or cents above zero.");
  }
  const id = newId();
  const req: PaymentRequest = { ...input, id, createdAt: new Date().toISOString() };
  await db.query(
    "insert into payments (id, spender_id, request, status, amount, currency) values ($1, $2, $3, 'checking', $4, $5)",
    [id, spender.id, JSON.stringify(req), input.money.amount, input.money.currency],
  );
  // From here on the row exists, so any crash must end as 'failed' with the reason, never stuck in 'checking'.
  let result: Payment;
  try {
    result = await decideAndHold(deps, spender, req);
  } catch (e) {
    return fail(db, id, "check", e);
  }
  if (deps.notify && ["needs_approval", "blocked", "protected"].includes(result.status)) {
    await deps.notify(result, spender).catch((e) => console.error(`[spotter] alert for ${id} failed:`, e instanceof Error ? e.message : e));
  }
  return result;
}

async function decideAndHold(deps: Deps, spender: Spender, req: PaymentRequest): Promise<Payment> {
  const { db } = deps;
  const id = req.id;
  await event(db, id, "requested", { amount: req.money.amount, payee: req.payee.name });

  const allowance: Allowance = {
    ...spender.allowance,
    spentThisWeek: { amount: await spentThisWeek(db, spender.id, spender.allowance.weekly.currency, id), currency: spender.allowance.weekly.currency },
  };
  req.payee = { ...req.payee, isNew: await isNewPayee(db, spender.id, req.payee.name, id) };
  const rules = checkRules(req, allowance);

  // Always run the check, even when a rule already blocks: the spotter needs the evidence
  // (a scam that is also over budget should be explained as a scam, not as "over budget").
  const [aiRaw, market] = await Promise.all([deps.check(req), marketCheck(deps, req)]);
  // Market evidence is code, not model output: it joins the flags as is.
  const ai: AiCheckResult = market?.flag ? { ...aiRaw, flags: [market.flag, ...aiRaw.flags] } : aiRaw;
  if (market) await setStatus(db, id, "checking", { market });
  await event(db, id, "checked", { ok: ai.ok, flags: ai.flags.length, dropped: ai.dropped, ...(ai.error ? { error: ai.error } : {}) });
  if (!ai.ok) console.error(`[spotter] AI check failed for ${id}: ${ai.error ?? "unknown"}`);

  const decision = decide(rules, ai, { amount: req.money.amount, askAbove: allowance.askAbove.amount });
  await event(db, id, "decided", { outcome: decision.outcome });

  if (decision.outcome === "block") return setStatus(db, id, "blocked", { decision, ai });
  if (decision.outcome === "protect") return setStatus(db, id, "protected", { decision, ai });

  let hold;
  try {
    hold = await deps.paypal.createAuthorizeOrder(req, { source: "card" });
  } catch (e) {
    return fail(db, id, "authorise", e, { decision, ai });
  }
  if (!hold.authorizationId) {
    return fail(db, id, "authorise", new Error("PayPal declined the card, so there is no hold to approve."), {
      decision,
      ai,
      paypal_order_id: hold.orderId,
    });
  }
  await event(db, id, "authorised", { orderId: hold.orderId });
  const held = await setStatus(db, id, decision.outcome === "allow" ? "authorised" : "needs_approval", {
    decision,
    ai,
    paypal_order_id: hold.orderId,
    paypal_authorization_id: hold.authorizationId,
    approve_url: hold.approveUrl ?? null,
  });
  return decision.outcome === "allow" ? capture(deps, held.id, "authorised", "Spotter") : held;
}

async function capture(deps: Deps, id: string, from: PaymentStatus, by: string): Promise<Payment> {
  const { db } = deps;
  const claimed = await transition(db, id, from, "capturing", by);
  if (!claimed) return (await getPayment(db, id))!;
  if (from === "needs_approval") await event(db, id, "approved", { by });
  // Only the PayPal call is guarded: once PayPal says captured, a later database error must not relabel it "failed".
  let c;
  try {
    c = await deps.paypal.captureAuthorization(claimed.paypal_authorization_id!, `capture-${id}`);
  } catch (e) {
    return fail(db, id, "capture", e);
  }
  await event(db, id, "captured", { captureId: c.captureId });
  return setStatus(db, id, "captured", { paypal_capture_id: c.captureId });
}

export const approve = (deps: Deps, id: string, by: string) => capture(deps, id, "needs_approval", by);

export async function deny(deps: Deps, id: string, by: string): Promise<Payment> {
  const { db } = deps;
  const claimed = await transition(db, id, "needs_approval", "voiding", by);
  if (!claimed) return (await getPayment(db, id))!;
  await event(db, id, "denied", { by });
  try {
    await deps.paypal.voidAuthorization(claimed.paypal_authorization_id!);
  } catch (e) {
    return fail(db, id, "void", e);
  }
  await event(db, id, "voided");
  return setStatus(db, id, "voided");
}

/** Clears a household's payments (and their events) so the allowances start fresh. */
export async function resetPayments(db: Db, householdId: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "delete from payments where spender_id in (select id from spenders where household_id = $1) returning id",
    [householdId],
  );
  return rows.length;
}
