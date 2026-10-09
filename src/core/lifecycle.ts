// The payment lifecycle: request -> rules -> AI check -> decision -> PayPal hold -> spotter -> capture or void.
// Every status change is a single conditional UPDATE, so double taps and races can't capture twice.
import type { Db } from "@/db";
import type { PaymentStatus } from "@/db/schema";
import type { AiCheckResult } from "@/ai/check";
import type { captureAuthorization, createAuthorizeOrder, voidAuthorization } from "@/paypal/client";
import { checkRules } from "./rules";
import { decide, type Decision } from "./decide";
import type { Allowance, Money, PaymentMethod, PaymentRequest } from "./types";

export type Deps = {
  db: Db;
  check: (req: PaymentRequest) => Promise<AiCheckResult>;
  paypal: {
    createAuthorizeOrder: typeof createAuthorizeOrder;
    captureAuthorization: typeof captureAuthorization;
    voidAuthorization: typeof voidAuthorization;
  };
};

export type SpenderKind = "agent" | "person" | "kid";
export type Spender = { id: string; name: string; kind: SpenderKind; spotter_name: string; allowance: Omit<Allowance, "spentThisWeek"> };

export type Payment = {
  id: string;
  spender_id: string;
  request: PaymentRequest;
  decision: Decision | null;
  ai: AiCheckResult | null;
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

export async function createSpender(
  db: Db,
  s: { id: string; name: string; kind: SpenderKind; spotterName: string; allowance: Omit<Allowance, "spentThisWeek"> },
) {
  await db.query(
    "insert into spenders (id, name, kind, spotter_name, allowance) values ($1, $2, $3, $4, $5) on conflict (id) do update set name = excluded.name, kind = excluded.kind, spotter_name = excluded.spotter_name, allowance = excluded.allowance",
    [s.id, s.name, s.kind, s.spotterName, JSON.stringify(s.allowance)],
  );
}

export async function getSpender(db: Db, id: string): Promise<Spender | null> {
  return (await db.query<Spender>("select * from spenders where id = $1", [id]))[0] ?? null;
}

export async function getPayment(db: Db, id: string): Promise<Payment | null> {
  return (await db.query<Payment>("select * from payments where id = $1", [id]))[0] ?? null;
}

export async function listPayments(db: Db, limit = 50): Promise<Payment[]> {
  return db.query<Payment>("select * from payments order by created_at desc limit $1", [limit]);
}

export async function listEvents(db: Db, paymentId: string) {
  return db.query<{ type: string; data: unknown; at: string }>("select type, data, at from events where payment_id = $1 order by id", [paymentId]);
}

async function spentThisWeek(db: Db, spenderId: string, currency: string): Promise<number> {
  const rows = await db.query<{ total: string | null }>(
    "select sum(amount)::text as total from payments where spender_id = $1 and currency = $2 and status = any($3) and created_at > now() - interval '7 days'",
    [spenderId, currency, HOLDING],
  );
  return Number(rows[0]?.total ?? 0);
}

const errText = (e: unknown) =>
  e instanceof Error ? `${e.message}${"issue" in e && e.issue ? ` (${String(e.issue)})` : ""}` : String(e);

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
  await event(db, id, "requested", { amount: input.money.amount, payee: input.payee.name });

  const allowance: Allowance = {
    ...spender.allowance,
    spentThisWeek: { amount: await spentThisWeek(db, spender.id, spender.allowance.weekly.currency), currency: spender.allowance.weekly.currency },
  };
  const rules = checkRules(req, allowance);
  const ruleBlock = !rules.valid || rules.hits.some((h) => h.outcome === "block");

  // Don't spend an AI call on something the rules already refuse.
  const ai: AiCheckResult = ruleBlock
    ? { ok: true, flags: [], dropped: 0, hidden: [], summary: "", injectionAttempt: false }
    : await deps.check(req);
  if (!ruleBlock) await event(db, id, "checked", { ok: ai.ok, flags: ai.flags.length, dropped: ai.dropped });

  const decision = decide(rules, ai, { amount: req.money.amount, askAbove: allowance.askAbove.amount });
  await event(db, id, "decided", { outcome: decision.outcome });

  if (decision.outcome === "block") return setStatus(db, id, "blocked", { decision, ai });
  if (decision.outcome === "protect") return setStatus(db, id, "protected", { decision, ai });

  let hold;
  try {
    hold = await deps.paypal.createAuthorizeOrder(req, { source: "card" });
  } catch (e) {
    await event(db, id, "failed", { step: "authorise", error: errText(e) });
    return setStatus(db, id, "failed", { decision, ai, error: errText(e) });
  }
  await event(db, id, "authorised", { orderId: hold.orderId });
  const held = await setStatus(db, id, decision.outcome === "allow" ? "authorised" : "needs_approval", {
    decision,
    ai,
    paypal_order_id: hold.orderId,
    paypal_authorization_id: hold.authorizationId ?? null,
    approve_url: hold.approveUrl ?? null,
  });
  return decision.outcome === "allow" ? capture(deps, held.id, "authorised", "Spotter") : held;
}

async function capture(deps: Deps, id: string, from: PaymentStatus, by: string): Promise<Payment> {
  const { db } = deps;
  const claimed = await transition(db, id, from, "capturing", by);
  if (!claimed) return (await getPayment(db, id))!;
  if (from === "needs_approval") await event(db, id, "approved", { by });
  try {
    const c = await deps.paypal.captureAuthorization(claimed.paypal_authorization_id!, `capture-${id}`);
    await event(db, id, "captured", { captureId: c.captureId });
    return setStatus(db, id, "captured", { paypal_capture_id: c.captureId });
  } catch (e) {
    await event(db, id, "failed", { step: "capture", error: errText(e) });
    return setStatus(db, id, "failed", { error: errText(e) });
  }
}

export const approve = (deps: Deps, id: string, by: string) => capture(deps, id, "needs_approval", by);

export async function deny(deps: Deps, id: string, by: string): Promise<Payment> {
  const { db } = deps;
  const claimed = await transition(db, id, "needs_approval", "voiding", by);
  if (!claimed) return (await getPayment(db, id))!;
  await event(db, id, "denied", { by });
  try {
    await deps.paypal.voidAuthorization(claimed.paypal_authorization_id!);
    await event(db, id, "voided");
    return setStatus(db, id, "voided");
  } catch (e) {
    await event(db, id, "failed", { step: "void", error: errText(e) });
    return setStatus(db, id, "failed", { error: errText(e) });
  }
}
