// The payment lifecycle: request -> rules -> AI check -> decision -> PayPal hold -> spotter -> capture or void.
// Every status change is a single conditional UPDATE, so double taps and races can't capture twice.
import type { Db } from "@/db";
import type { PaymentStatus } from "@/db/schema";
import type { AiCheckResult } from "@/ai/check";
import { PayPalError, type captureAuthorization, type createAuthorizeOrder, type voidAuthorization } from "@/paypal/client";
import { checkRules, normName } from "./rules";
import { decide, type Decision } from "./decide";
import type { Flag } from "./grounding";
import type { Allowance, Currency, Money, PaymentMethod, PaymentRequest } from "./types";
import { priceCheck, type MarketResult, type Offer } from "./market";
import { fileReport } from "./network";
import type { Case } from "@/agents/case";
import { startWasItYou, type WasItYou } from "./was-it-you";

export type Deps = {
  db: Db;
  check: (req: PaymentRequest) => Promise<AiCheckResult>;
  /** Real retailer offers for an item (Channel3). null means the lookup couldn't run. Optional. */
  market?: (item: string, currency: Currency) => Promise<Offer[] | null>;
  /** Tells the spotter about a payment that needs them or was stopped. Failures are logged, never fatal. */
  notify?: (payment: Payment, spender: Spender) => Promise<void>;
  /** Looks into a held or stopped payment and files a case for the spotter (the case agent). Optional. */
  investigate?: (payment: Payment, spender: Spender) => Promise<Case>;
  /** Tells the person who wanted to pay what their spotter decided. Failures are logged, never fatal. */
  decided?: (payment: Payment, spender: Spender) => Promise<void>;
  /** Tells the spotter PayPal confirmed a held payment was paid or released (from a PayPal webhook). Optional. */
  confirmed?: (payment: Payment, spender: Spender) => Promise<void>;
  /** Tells a household's spotter that someone switched a protection off (core/switchedoff.ts). Optional. */
  warn?: (householdId: string, w: { kind: "paypal_disconnected" | "channel_moved" | "chat_blocked" | "agent_hijacked" | "refund_held" | "subscription_held"; text: string }) => Promise<void>;
  /** Asks the real person a message claims to be from ("Was it you?") on their own linked channel. Optional. */
  ask?: (payment: Payment, payer: Spender, ask: WasItYou, to: Spender) => Promise<void>;
  /** A short plain note to the spotter (e.g. "Tom says it wasn't him"). Failures are logged, never fatal. Optional. */
  note?: (payment: Payment, payer: Spender, text: string) => Promise<boolean>;
  /** Runs work after the response is sent (Next's after()). Without it, follow up work runs inline. */
  defer?: (task: () => Promise<void>) => void;
  paypal: {
    createAuthorizeOrder: typeof createAuthorizeOrder;
    captureAuthorization: typeof captureAuthorization;
    voidAuthorization: typeof voidAuthorization;
    /** Looks up an authorisation's status at PayPal. Optional: only reconciliation needs it. */
    getAuthorization?: (authorizationId: string) => Promise<{ status: string; expiresAt?: string }>;
    /** A fresh hold after the 3 day honor period (core/sleep.ts). Optional: only the daily job needs it. */
    reauthorizeAuthorization?: (authorizationId: string, idempotencyKey: string) => Promise<{ authorizationId: string; expiresAt?: string }>;
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
  discord_user_id: string | null;
  allowance: Omit<Allowance, "spentThisWeek">;
  /** An AI agent's job for PayPal's toolkit (src/core/toolkit-coverage.ts). Optional so older rows and samples type check. */
  agent_job?: string;
  /** Set when an agent reached for a bait tool (src/core/tripwire.ts). Nothing it asks for goes through until the PIN clears it. */
  frozen_at?: string | Date | null;
};
export type NewSpender = { id: string; householdId: string; name: string; kind: SpenderKind; spotterName: string; allowance: Omit<Allowance, "spentThisWeek"> };

export type Payment = {
  id: string;
  spender_id: string;
  request: PaymentRequest;
  decision: Decision | null;
  ai: AiCheckResult | null;
  market: (MarketResult & { item: string }) | null;
  case_file: Case | null;
  /** "Was it you?": the ask to the person the message claims to be from, and their answer. Optional for older rows. */
  was_it_you?: WasItYou | null;
  /** Scrolls the spotter made looking at the page safely (listPayments only), for the proof card. Null when never looked. */
  peek_scrolls?: number | null;
  status: PaymentStatus;
  amount: string | number;
  currency: string;
  paypal_order_id: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  /** When PayPal drops the hold if nobody captures it. Optional so older rows and samples still type check. */
  paypal_auth_expires_at?: string | Date | null;
  /** "Ask again tomorrow" (core/sleep.ts): when Spotter asks the spotter again, and how many times someone slept on it. */
  ask_again_at?: string | Date | null;
  sleeps?: number;
  /** Set once PayPal gave the hold a fresh honor period; reauth_note says why it couldn't, in plain words. */
  reauthorized_at?: string | Date | null;
  reauth_note?: string | null;
  approve_url: string | null;
  /** What Spotter sent PayPal as the order's custom_id (agent orders: key label + payment id). Optional for older rows. */
  paypal_custom_id?: string | null;
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
  /**
   * Only set by core/safer.ts after it validated an offer Spotter itself suggested: the stopped payment this replaces
   * and the retailer Channel3 vouched for. That retailer doesn't count as a new payee; every other check still runs.
   */
  saferFor?: { paymentId: string; offerId: string; domain: string; reason: string; fromPayee: string };
  /** Evidence found by code before the check (e.g. core/cutup.ts). Joins the AI's flags as is, like the price check. */
  codeFlags?: Flag[];
  /** The agent key's public label (core/pairing.ts keyLabel, e.g. "spt-abcd"). Goes to PayPal as the order's custom_id. */
  agentKey?: string;
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
    `select p.*, (select sum(k.scrolls)::int from peeks k where k.payment_id = p.id and k.session_sealed is not null) as peek_scrolls
     from payments p join spenders s on s.id = p.spender_id where s.household_id = $1 order by p.created_at desc limit $2`,
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
    // "Priced like a used one" is skipped when the item or the message says it is used or refurbished.
    return offers ? { ...priceCheck(req.money.amount, req.money.currency, offers, { item: `${req.item} ${req.context ?? ""}` }), item: req.item } : null;
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

/** Lets the person know the spotter's answer. Best effort: the decision already stands. */
async function tellDecided(deps: Deps, p: Payment) {
  if (!deps.decided) return;
  try {
    const spender = await getSpender(deps.db, p.spender_id);
    if (spender) await deps.decided(p, spender);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[spotter] telling the payer about ${p.id} failed: ${error}`);
    await event(deps.db, p.id, "tell_failed", { error }).catch(() => {});
  }
}

/** Tell the Spotter network about a payee a family said no to. Best effort: it never changes the payment. */
async function report(db: Db, paymentId: string, householdId: string, identifier: string, kind: "denied" | "blocked") {
  try {
    await fileReport(db, { householdId, identifier, kind });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[spotter] network report for ${paymentId} failed: ${error}`);
    await event(db, paymentId, "report_failed", { error }).catch(() => {});
  }
}

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
  // A paused (frozen) agent reached for a tool its job doesn't use (core/tripwire.ts). Only the spotter's PIN unpauses it.
  if (spender.frozen_at) throw new InvalidPaymentError(`${spender.name} is frozen: Spotter paused it after it reached for a tool its job doesn't use. Nothing was paid. Only ${spender.spotter_name} can unpause it.`);

  if (!Number.isInteger(input.money.amount) || input.money.amount <= 0) {
    throw new InvalidPaymentError("Amount must be a whole number of pence or cents above zero.");
  }
  const id = newId();
  const { saferFor, codeFlags, agentKey, ...rest } = input;
  const req: PaymentRequest = {
    ...rest,
    id,
    createdAt: new Date().toISOString(),
    ...(saferFor
      ? { swappedFrom: saferFor.paymentId, saferOption: { offer_id: saferFor.offerId, reason: saferFor.reason, from_payee: saferFor.fromPayee } }
      : {}),
  };
  await db.query(
    "insert into payments (id, spender_id, request, status, amount, currency) values ($1, $2, $3, 'checking', $4, $5)",
    [id, spender.id, JSON.stringify(req), input.money.amount, input.money.currency],
  );
  // From here on the row exists, so any crash must end as 'failed' with the reason, never stuck in 'checking'.
  let result: Payment;
  try {
    result = await decideAndHold(deps, spender, req, saferFor?.domain, codeFlags, agentKey);
  } catch (e) {
    return crashed(deps, id, e);
  }
  if (["needs_approval", "blocked", "protected"].includes(result.status)) {
    const followUp = () => investigateAndAlert(deps, result, spender);
    if (deps.defer) deps.defer(followUp);
    else await followUp();
  }
  return result;
}

/**
 * A crash part way through the check. With no hold at PayPal it ends failed. With a live hold it must never be "failed"
 * (nothing would ever void it): it stays where it is with the reason, and a hold Spotter was about to pay goes back
 * to the spotter instead.
 */
async function crashed(deps: Deps, id: string, e: unknown): Promise<Payment> {
  const { db } = deps;
  const now = await getPayment(db, id).catch(() => null);
  const live: PaymentStatus[] = ["needs_approval", "authorised", "capturing", "voiding"];
  if (!now?.paypal_authorization_id || !live.includes(now.status)) return fail(db, id, "check", e);
  const error = `Spotter hit an error after PayPal made the hold, so it waits for the spotter: ${errText(e)}`.slice(0, 500);
  console.error(`[spotter] payment ${id} crashed with a live PayPal hold (${now.status}); kept, not failed: ${errText(e)}`);
  await event(db, id, "crashed_with_hold", { status: now.status, error: errText(e).slice(0, 300) }).catch(() => {});
  const to = now.status === "authorised" ? "needs_approval" : now.status;
  return (await move(db, id, now.status, to, { error }).catch(() => null)) ?? now;
}

const CASE_CAP_MS = 45_000;

/** The case first (so the alert can carry it), then the alert. Neither can change the payment's status. */
async function investigateAndAlert(deps: Deps, payment: Payment, spender: Spender): Promise<void> {
  const { db } = deps;
  const id = payment.id;
  // Ask the person the message claims to be from first: they can answer while the case is still being built.
  let current = payment.status === "needs_approval" ? await startWasItYou(deps, payment, spender) : payment;
  if (deps.investigate) {
    try {
      // Hard cap on top of the agent's own budget, so a stuck case can never hold back the alert for long.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const c = await Promise.race([
        deps.investigate(current, spender),
        new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("the case took too long")), CASE_CAP_MS))),
      ]).finally(() => clearTimeout(timer));
      const rows = await db.query<Payment>("update payments set case_file = $2 where id = $1 returning *", [id, JSON.stringify(c)]);
      current = rows[0] ?? current;
      await event(db, id, "case_built", { status: c.status, verdict: c.verdict, calls: c.calls.length, ms: c.ms, ...(c.error ? { error: c.error } : {}) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[spotter] case for ${id} failed: ${error}`);
      await event(db, id, "case_failed", { error }).catch(() => {});
    }
  }
  if (deps.notify) {
    // The asked person may have answered already ("Not me" voids it): alert from the payment as it is now.
    current = (await getPayment(db, id).catch(() => null)) ?? current;
    await deps.notify(current, spender).catch(async (e) => {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[spotter] alert for ${id} failed:`, error);
      await event(db, id, "alert_failed", { error }).catch(() => {});
    });
  }
}

/** knownRetailer: a retailer Spotter itself suggested (validated in core/safer.ts), so it isn't a "first time" payee. */
async function decideAndHold(deps: Deps, spender: Spender, req: PaymentRequest, knownRetailer?: string, codeFlags: Flag[] = [], agentKey?: string): Promise<Payment> {
  const { db } = deps;
  const id = req.id;
  await event(db, id, "requested", { amount: req.money.amount, payee: req.payee.name, ...(req.swappedFrom ? { swappedFrom: req.swappedFrom } : {}) });

  const allowance: Allowance = {
    ...spender.allowance,
    allowedPayees: knownRetailer ? [...spender.allowance.allowedPayees, knownRetailer] : spender.allowance.allowedPayees,
    spentThisWeek: { amount: await spentThisWeek(db, spender.id, spender.allowance.weekly.currency, id), currency: spender.allowance.weekly.currency },
  };
  req.payee = { ...req.payee, isNew: await isNewPayee(db, spender.id, req.payee.name, id) };
  const rules = checkRules(req, allowance);

  // Always run the check, even when a rule already blocks: the spotter needs the evidence
  // (a scam that is also over budget should be explained as a scam, not as "over budget").
  const [aiRaw, market] = await Promise.all([deps.check(req), marketCheck(deps, req)]);
  // Market evidence is code, not model output: it joins the flags as is.
  const found = [...(market?.flag ? [market.flag] : []), ...codeFlags];
  const ai: AiCheckResult = found.length ? { ...aiRaw, flags: [...found, ...aiRaw.flags] } : aiRaw;
  if (market) await setStatus(db, id, "checking", { market });
  await event(db, id, "checked", { ok: ai.ok, flags: ai.flags.length, dropped: ai.dropped, ...(ai.aiEngine ? { engine: ai.aiEngine } : {}), ...(ai.error ? { error: ai.error } : {}) });
  if (!ai.ok) console.error(`[spotter] AI check failed for ${id}: ${ai.error ?? "unknown"}`);

  const decision = decide(rules, ai, { amount: req.money.amount, askAbove: allowance.askAbove.amount });
  await event(db, id, "decided", { outcome: decision.outcome });

  if (decision.outcome === "block") {
    // Only strong scam signs go to the network; an over budget block says nothing about the payee.
    if (ai.flags.some((f) => f.severity === "high")) await report(db, id, spender.household_id, req.payee.name, "blocked");
    return setStatus(db, id, "blocked", { decision, ai });
  }
  if (decision.outcome === "protect") return setStatus(db, id, "protected", { decision, ai });

  // The check took a while: if a tripwire paused this agent meanwhile, no hold is made at all.
  if (await isFrozen(db, spender.id)) {
    await event(db, id, "frozen_before_hold");
    const paused: Decision = { ...decision, outcome: "block", reasons: [`${spender.name} was paused by a tripwire while this was being checked. Nothing was sent to PayPal.`, ...decision.reasons] };
    return setStatus(db, id, "blocked", { decision: paused, ai });
  }

  const customId = agentKey ? `${agentKey}:${id}` : undefined;
  let hold;
  try {
    hold = await deps.paypal.createAuthorizeOrder(req, customId ? { source: "card", customId } : { source: "card" });
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
    paypal_auth_expires_at: hold.expiresAt ?? null,
    ...(customId ? { paypal_custom_id: customId } : {}),
  });
  // The tripwire race: it may have frozen the agent and swept its holds while PayPal was making this one. Checked after
  // the hold is saved, so either the sweep saw it or this sees the freeze. Either way the hold is let go, never paid.
  if (await isFrozen(db, spender.id)) {
    await event(db, id, "frozen_during_hold");
    if (held.status === "authorised") await transition(db, id, "authorised", "needs_approval");
    return deny(deps, id, PAUSED_BY);
  }
  return decision.outcome === "allow" ? capture(deps, held.id, "authorised", "Spotter") : held;
}

export const PAUSED_BY = "Spotter (the agent was paused)";

async function isFrozen(db: Db, spenderId: string): Promise<boolean> {
  return !!(await getSpender(db, spenderId))?.frozen_at;
}

/** Same payment + same authorisation = same key, so a retry is one request at PayPal. A new authorisation (after a
 * reauthorization) gets a new key, so an old cached answer can't be replayed for it. */
export const captureKey = (id: string, authorizationId: string) => `capture-${id}-${authorizationId}`;
export const voidKey = (id: string, authorizationId: string) => `void-${id}-${authorizationId}`;

const UNCONFIRMED = "PayPal didn't confirm yet, Spotter is retrying";
// PayPal issues that mean the hold itself is gone, so nothing is held and nothing was paid.
const HOLD_GONE_ISSUES = new Set(["AUTHORIZATION_EXPIRED", "AUTHORIZATION_VOIDED", "AUTHORIZATION_DENIED"]);
const GONE = new Set(["VOIDED", "EXPIRED", "DENIED"]);
const TAKEN = new Set(["CAPTURED", "PARTIALLY_CAPTURED"]);
// PayPal answering a repeated PayPal-Request-Id while the first request is still running: not a yes or a no.
const IN_PROGRESS_ISSUES = new Set(["PREVIOUS_REQUEST_IN_PROGRESS", "DUPLICATE_REQUEST_ID"]);

/** A clear no from PayPal for this request (a 4xx that isn't rate limiting or "the same request is still running"). */
const isFirm = (e: unknown) => e instanceof PayPalError && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 409 && !IN_PROGRESS_ISSUES.has(e.issue ?? "");

/** A void PayPal refused or didn't answer. A firm refusal is checked with PayPal at once (it may have been captured or
 * already released); anything else stays voiding for reconcile. */
async function voidFailed(deps: Deps, id: string, e: unknown): Promise<Payment> {
  const left = await unconfirmed(deps.db, id, "voiding", "void", e);
  if (!isFirm(e) || !deps.paypal.getAuthorization || left.status !== "voiding") return left;
  try {
    await finishWithPayPal(deps, left, { voidAgain: false });
  } catch (err) {
    console.error(`[spotter] payment ${id}: checking a refused void with PayPal failed:`, errText(err));
  }
  return (await getPayment(deps.db, id)) ?? left;
}

/** Conditional move that also writes columns. Null if the payment wasn't in `from` any more. */
async function move(db: Db, id: string, from: PaymentStatus, to: PaymentStatus, extra: Record<string, unknown> = {}): Promise<Payment | null> {
  const cols = Object.keys(extra);
  const sets = ["status = $3", "updated_at = now()", ...cols.map((c, i) => `${c} = $${i + 4}`)];
  const rows = await db.query<Payment>(`update payments set ${sets.join(", ")} where id = $1 and status = $2 returning *`, [id, from, to, ...cols.map((c) => extra[c])]);
  return rows[0] ?? null;
}

/** PayPal didn't say yes or no (timeout, 5xx, network). The payment stays where it is, with the reason, for reconcile. */
async function unconfirmed(db: Db, id: string, status: PaymentStatus, step: "void" | "capture", e: unknown): Promise<Payment> {
  const error = `${UNCONFIRMED}: ${errText(e)}`.slice(0, 500);
  console.error(`[spotter] payment ${id}: PayPal didn't confirm the ${step}, left ${status} for reconcile: ${errText(e)}`);
  await event(db, id, `${step}_unconfirmed`, { error: errText(e).slice(0, 300) }).catch(() => {});
  const rows = await db.query<Payment>("update payments set error = $3, updated_at = now() where id = $1 and status = $2 returning *", [id, status, error]);
  return rows[0] ?? (await getPayment(db, id))!;
}

/**
 * A capture PayPal refused or didn't answer. Only a firm 4xx is a no; even then the authorisation may still be live, so
 * PayPal is asked: still there goes back to the spotter, gone ends failed, captured is captured. Anything else stays
 * capturing for reconcile, which captures again with the same key.
 */
async function captureFailed(deps: Deps, p: Payment, e: unknown): Promise<Payment> {
  const { db } = deps;
  if (!isFirm(e)) return unconfirmed(db, p.id, "capturing", "capture", e);
  let status: string | null = null;
  if (deps.paypal.getAuthorization) {
    try {
      status = (await deps.paypal.getAuthorization(p.paypal_authorization_id!)).status;
    } catch (lookupError) {
      console.error(`[spotter] payment ${p.id}: capture refused and the authorisation lookup failed:`, errText(lookupError));
    }
  }
  if (status && TAKEN.has(status)) {
    const done = await move(db, p.id, "capturing", "captured", { error: null });
    await event(db, p.id, "reconciled", { paypal: status, after: "capture_refused" });
    return done ?? (await getPayment(db, p.id))!;
  }
  if (status === "CREATED") {
    const error = `PayPal didn't take the payment: ${errText(e)}. The hold is still there: approve again, or deny to let it go.`.slice(0, 500);
    await event(db, p.id, "capture_refused", { error: errText(e).slice(0, 300), hold: "still there" });
    return (await move(db, p.id, "capturing", "needs_approval", { error })) ?? (await getPayment(db, p.id))!;
  }
  const issue = e instanceof PayPalError ? e.issue : undefined;
  if ((status && GONE.has(status)) || (!status && HOLD_GONE_ISSUES.has(issue ?? ""))) return fail(db, p.id, "capture", e);
  return unconfirmed(db, p.id, "capturing", "capture", e);
}

async function capture(deps: Deps, id: string, from: PaymentStatus, by: string): Promise<Payment> {
  const { db } = deps;
  const claimed = await transition(db, id, from, "capturing", by);
  if (!claimed) return (await getPayment(db, id))!;
  if (from === "needs_approval") await event(db, id, "approved", { by });
  // Only the PayPal call is guarded: once PayPal says captured, a later database error must not relabel it "failed".
  // A paused agent's hold is never paid, even if Spotter had already decided to pay it.
  if (from === "authorised" && (await isFrozen(db, claimed.spender_id))) {
    await event(db, id, "frozen_before_capture");
    await transition(db, id, "capturing", "needs_approval");
    return deny(deps, id, PAUSED_BY);
  }
  return captureClaimed(deps, claimed, from === "needs_approval");
}

/** The PayPal half of a capture, for a payment already in "capturing". Also used by reconcile to finish one. */
async function captureClaimed(deps: Deps, claimed: Payment, tell: boolean): Promise<Payment> {
  const { db } = deps;
  const id = claimed.id;
  let c;
  try {
    c = await deps.paypal.captureAuthorization(claimed.paypal_authorization_id!, captureKey(id, claimed.paypal_authorization_id!));
  } catch (e) {
    return captureFailed(deps, claimed, e);
  }
  await event(db, id, "captured", { captureId: c.captureId });
  const done = await setStatus(db, id, "captured", { paypal_capture_id: c.captureId, error: null });
  if (tell) await tellDecided(deps, done);
  return done;
}

export const approve = (deps: Deps, id: string, by: string) => capture(deps, id, "needs_approval", by);

export async function deny(deps: Deps, id: string, by: string): Promise<Payment> {
  const { db } = deps;
  const claimed = await transition(db, id, "needs_approval", "voiding", by);
  if (!claimed) return (await getPayment(db, id))!;
  await event(db, id, "denied", { by });
  try {
    await deps.paypal.voidAuthorization(claimed.paypal_authorization_id!, voidKey(id, claimed.paypal_authorization_id!));
  } catch (e) {
    // Never "failed" with a live hold: it stays voiding and reconcile (or a manual retry) asks PayPal and finishes it.
    return voidFailed(deps, id, e);
  }
  await event(db, id, "voided");
  const spender = await getSpender(db, claimed.spender_id);
  if (spender) await report(db, id, spender.household_id, claimed.request.payee.name, "denied");
  const done = await setStatus(db, id, "voided");
  await tellDecided(deps, done);
  return done;
}

/**
 * The agent lets go of its own held payment (it chose the safer option Spotter suggested). Only ever releases money:
 * the hold is voided, nothing is paid, and unlike a spotter's deny it says nothing to the Spotter network.
 */
export async function withdraw(deps: Deps, id: string, by: string): Promise<Payment> {
  const { db } = deps;
  const claimed = await transition(db, id, "needs_approval", "voiding", by);
  if (!claimed) return (await getPayment(db, id))!;
  await event(db, id, "withdrawn", { by });
  try {
    await deps.paypal.voidAuthorization(claimed.paypal_authorization_id!, voidKey(id, claimed.paypal_authorization_id!));
  } catch (e) {
    return voidFailed(deps, id, e);
  }
  await event(db, id, "voided");
  return setStatus(db, id, "voided");
}

/** A check that was cut off (the server stopped mid way) never finished. Nothing reached PayPal's capture, so it
 * is marked failed and stops counting against the allowance. Holds stuck mid capture are left for a person. */
/**
 * The safe swap: the spotter turns down a held payment and pays the genuine shop the case agent found instead.
 * The old hold is voided first; only when that worked is the new payment made, already approved by the spotter.
 */
export async function swap(deps: Deps, id: string, by: string): Promise<{ from: Payment; to: Payment | null }> {
  const { db } = deps;
  const before = await getPayment(db, id);
  if (!before) throw new Error("No such payment.");
  if (before.status !== "needs_approval") throw new Error(`This payment is already ${before.status}.`);
  const offer = before.case_file?.swap;
  if (!offer) throw new Error("Spotter found no safer option for this payment.");

  const from = await deny(deps, id, by);
  if (from.status !== "voided") return { from, to: null };

  const spender = (await getSpender(db, before.spender_id))!;
  const newIdValue = newId();
  const req: PaymentRequest = {
    id: newIdValue,
    spenderId: spender.id,
    money: { amount: offer.price, currency: offer.currency as Currency },
    payee: { name: offer.domain, isNew: true },
    category: before.request.category,
    method: "paypal_order",
    item: offer.title,
    context: `${by} chose ${offer.title} from ${offer.domain} (${offer.url}) instead of paying ${before.request.payee.name}.`,
    createdAt: new Date().toISOString(),
    swappedFrom: id,
  };
  const decision: Decision = { outcome: "allow", reasons: [`${by} chose this instead of ${before.request.payee.name}.`], flags: [] };
  await db.query(
    "insert into payments (id, spender_id, request, status, amount, currency, decision) values ($1, $2, $3, 'authorised', $4, $5, $6)",
    [req.id, spender.id, JSON.stringify(req), offer.price, offer.currency, JSON.stringify(decision)],
  );
  await event(db, id, "swapped", { to: req.id, shop: offer.domain, price: offer.price });
  await event(db, req.id, "requested", { amount: offer.price, payee: offer.domain, swappedFrom: id });

  let hold;
  try {
    hold = await deps.paypal.createAuthorizeOrder(req, { source: "card" });
  } catch (e) {
    return { from, to: await fail(db, req.id, "authorise", e) };
  }
  if (!hold.authorizationId) return { from, to: await fail(db, req.id, "authorise", new Error("PayPal declined the card.")) };
  await setStatus(db, req.id, "authorised", {
    paypal_order_id: hold.orderId,
    paypal_authorization_id: hold.authorizationId,
    paypal_auth_expires_at: hold.expiresAt ?? null,
  });
  return { from, to: await capture(deps, req.id, "authorised", by) };
}

export async function sweepStale(db: Db, minutes = 5): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `update payments set status = 'failed', error = 'Spotter stopped before finishing this check. Nothing was paid.', updated_at = now()
     where status = 'checking' and updated_at < now() - make_interval(mins => $1) returning id`,
    [minutes],
  );
  return rows.length;
}

/** A capture that was cut off between calling PayPal and saving the answer stays "capturing". Ask PayPal what
 * really happened and settle it: captured, released (voided or expired), or back to waiting for the spotter.
 * A failed lookup leaves the payment as it is, to try again later. */
export async function reconcileStuck(deps: Deps, minutes = 5): Promise<number> {
  const { db, paypal } = deps;
  if (!paypal.getAuthorization) return 0;
  // Captures and voids PayPal never confirmed (cut off, timed out, or PayPal down when the spotter tapped).
  const stuck = await db.query<Payment>(
    "select * from payments where status in ('capturing', 'voiding') and paypal_authorization_id is not null and updated_at < now() - make_interval(mins => $1)",
    [minutes],
  );
  let settled = 0;
  for (const p of stuck) {
    try {
      if (await finishWithPayPal(deps, p)) settled++;
    } catch (e) {
      // One payment's trouble never stops the rest of the run.
      console.error(`[spotter] reconcile for ${p.id} crashed:`, errText(e));
    }
  }
  return settled;
}

/**
 * Asks PayPal what really happened to a capture or void it never confirmed, and finishes it idempotently: a hold still
 * there is voided (or captured) again with the same PayPal-Request-Id. True when the payment reached a final status.
 */
async function finishWithPayPal(deps: Deps, p: Payment, opts: { voidAgain?: boolean } = {}): Promise<boolean> {
  const { db, paypal } = deps;
  const auth = p.paypal_authorization_id!;
  let status: string;
  try {
    status = (await paypal.getAuthorization!(auth)).status;
  } catch (e) {
    console.error(`[spotter] reconcile lookup failed for ${p.id}:`, errText(e));
    return false;
  }
  if (p.status === "voiding") {
    if (GONE.has(status)) {
      const done = await move(db, p.id, "voiding", "voided", { error: null });
      if (!done) return false;
      await event(db, p.id, "reconciled", { paypal: status });
      await tellDecided(deps, done);
      return true;
    }
    if (TAKEN.has(status)) {
      // The spotter said no but PayPal took the money (an earlier capture won the race). Never hidden.
      const done = await move(db, p.id, "voiding", "captured", { error: "PayPal says this hold was captured, although it was being let go. Check it in PayPal." });
      if (!done) return false;
      console.error(`[spotter] payment ${p.id} was being voided but PayPal says ${status}`);
      await event(db, p.id, "paypal_mismatch", { paypal: status, spotter_status: "voiding", reason: "captured at PayPal while Spotter was letting it go" });
      return true;
    }
    if (status !== "CREATED" || opts.voidAgain === false) return false;
    try {
      await paypal.voidAuthorization(auth, voidKey(p.id, auth));
    } catch (e) {
      await unconfirmed(db, p.id, "voiding", "void", e);
      return false;
    }
    const done = await move(db, p.id, "voiding", "voided", { error: null });
    if (!done) return false;
    await event(db, p.id, "voided", { by: "reconcile" });
    await tellDecided(deps, done);
    return true;
  }
  if (TAKEN.has(status)) {
    const done = await move(db, p.id, "capturing", "captured", { error: null });
    if (done) await event(db, p.id, "reconciled", { paypal: status });
    return !!done;
  }
  if (GONE.has(status)) {
    // Approved, but PayPal let the hold go before the capture landed: nothing was paid, and the spotter must hear it.
    const done = await move(db, p.id, "capturing", "voided", { error: "PayPal let the hold lapse before the payment went through. Nothing was paid." });
    if (!done) return false;
    console.error(`[spotter] payment ${p.id} was approved but PayPal says the hold is ${status}; nothing was paid`);
    await event(db, p.id, "reconciled", { paypal: status, note: "hold lapsed before capture" });
    await tellDecided(deps, done);
    return true;
  }
  // PENDING: PayPal is reviewing the authorisation. Leave it, and ask again next run.
  if (status !== "CREATED") return false;
  // A paused agent's hold is never paid, even one Spotter had already decided to pay before the freeze.
  if (await isFrozen(db, p.spender_id)) {
    await event(db, p.id, "frozen_before_capture", { by: "reconcile" });
    if (!(await transition(db, p.id, "capturing", "needs_approval"))) return false;
    return (await deny(deps, p.id, PAUSED_BY)).status !== "needs_approval";
  }
  // Someone already decided to pay this. Finish the capture with the same key (PayPal dedupes a repeat).
  const after = await captureClaimed(deps, p, !!p.decided_by && p.decided_by !== "Spotter");
  return after.status !== "capturing";
}

export type RetryResult = { ok: true; payment: Payment } | { ok: false; status: 404 | 409 | 502; error: string };

/** The spotter's "Try PayPal again" on a capture or void PayPal didn't confirm. Only their own household's payment. */
export async function retryWithPayPal(deps: Deps, id: string, householdId: string): Promise<RetryResult> {
  const p = await getPayment(deps.db, id, householdId);
  if (!p) return { ok: false, status: 404, error: "No such payment." };
  if ((p.status !== "voiding" && p.status !== "capturing") || !p.paypal_authorization_id) return { ok: false, status: 409, error: "Nothing is waiting on PayPal for this payment." };
  if (!deps.paypal.getAuthorization) return { ok: false, status: 502, error: "Spotter can't ask PayPal right now." };
  const done = await finishWithPayPal(deps, p);
  const now = (await getPayment(deps.db, id))!;
  return done ? { ok: true, payment: now } : { ok: false, status: 502, error: "PayPal still hasn't confirmed. Spotter asks again within a day, or try again later." };
}

/** Records what PayPal says happened (from a webhook). One conditional UPDATE: it only moves a payment that is
 * still in one of the expected statuses, so it can never fight an approve or deny tap. Never calls PayPal. */
export async function settleFromPayPal(
  db: Db,
  id: string,
  from: PaymentStatus[],
  to: PaymentStatus,
  extra: { paypal_capture_id?: string; error?: string } = {},
): Promise<Payment | null> {
  const rows = await db.query<Payment>(
    // An old error (say a capture call that timed out) no longer applies once PayPal says how it really ended.
    `update payments set status = $3, paypal_capture_id = coalesce($4, paypal_capture_id), error = $5, updated_at = now()
     where id = $1 and status = any($2) returning *`,
    [id, from, to, extra.paypal_capture_id ?? null, extra.error ?? null],
  );
  return rows[0] ?? null;
}

/** Clears a household's payments (and their events) so the allowances start fresh. */
export async function resetPayments(db: Db, householdId: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "delete from payments where spender_id in (select id from spenders where household_id = $1) returning id",
    [householdId],
  );
  return rows.length;
}
