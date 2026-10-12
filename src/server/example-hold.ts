// The demo family's example hold: so a judge sees a real hold straight away without spending a send.
// The money part is real (a PayPal sandbox authorisation, free to make, and approve or deny capture or void
// it for real). The check and the case file were written earlier, so it is labelled a sample message on a live
// PayPal hold, never passed off as a live check. Its text is the landing page's "it's Tom, new number" story, word for
// word. If PayPal is down or slow, the family starts without it.
import type { Db } from "@/db";
import type { AiCheckResult } from "@/ai/check";
import { decide } from "@/core/decide";
import type { Flag } from "@/core/grounding";
import { listSpenders } from "@/core/households";
import type { Deps } from "@/core/lifecycle";
import { checkRules } from "@/core/rules";
import type { PaymentRequest } from "@/core/types";
import type { Case } from "@/agents/case";
import { randomBytes } from "node:crypto";
import { ANSWER_MINUTES, claimFromText, type WasItYou } from "@/core/was-it-you";

import { EXAMPLE_LABEL } from "@/ui/labels";
export { EXAMPLE_LABEL };
// A cold start (OAuth token, then the order) took about 3.5 s against the sandbox on 2026-10-10.
const PAYPAL_WAIT_MS = 8000;

/**
 * The case file. The seeded hold is labelled a sample (EXAMPLE_LABEL). The Was it you run is the visitor's own (they
 * start it on Try and answer as Tom), so it carries no example label; its warning signs each quote the message.
 */
function exampleCase(payee: string, authorizationId: string, live?: { headline: string }): Case {
  const calls = [
    { id: "example_history", tool: "payee_history", args: { payee }, ok: true, summary: `Gran has never paid ${payee}.` },
    { id: "example_hold", tool: "paypal_hold", args: { authorizationId }, ok: true, summary: "PayPal is holding £250.00. Nothing is paid until you approve." },
  ];
  return {
    status: "done",
    verdict: "likely_scam",
    headline: live?.headline ?? `${EXAMPLE_LABEL}: this looks like the Hi Mum scam. Someone on a new number says they're Tom and wants £250 sent to a friend's account today.`,
    findings: [
      { text: `Gran has never paid ${payee} before.`, tool: "payee_history", source: "example_history" },
      { text: "PayPal is holding the £250 in the sandbox. Deny releases it, approve pays it.", tool: "paypal_hold", source: "example_hold" },
    ],
    ask: ["Ring Tom on the number you already have for him and ask if he sent this.", "Don't reply to the new number or call it back."],
    calls,
    dropped: 0,
    model: "example",
    ms: 0,
    ...(live ? {} : { example: true }),
  };
}

/** Creates the example hold for a demo household's Gran. Never throws for PayPal trouble. */
export async function createExampleHold(
  deps: { db: Db; paypal: Pick<Deps["paypal"], "createAuthorizeOrder"> },
  householdId: string,
  waitMs = PAYPAL_WAIT_MS,
): Promise<"created" | "paypal_unavailable" | "no_relative"> {
  const { db } = deps;
  const gran = (await listSpenders(db, householdId)).find((s) => s.kind === "person");
  if (!gran) return "no_relative";
  const id = `pay_${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const req = tomRequest(id, gran.id);
  const hold = await holdAtPayPal(deps, req, waitMs);
  if (!hold) return "paypal_unavailable";
  await insertExample(db, gran, req, hold, TOM_FLAGS, `${EXAMPLE_LABEL}. Someone on a new number says they're Tom, in a hurry, asking for £250 for a friend's account.`);
  return "created";
}

type Hold = Awaited<ReturnType<Deps["paypal"]["createAuthorizeOrder"]>> & { authorizationId: string };

/** A real sandbox authorisation, or null when PayPal is down, slow or gives none. Never throws. */
async function holdAtPayPal(deps: { paypal: Pick<Deps["paypal"], "createAuthorizeOrder"> }, req: PaymentRequest, waitMs: number): Promise<Hold | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hold: Awaited<ReturnType<Deps["paypal"]["createAuthorizeOrder"]>> | null;
  try {
    hold = await Promise.race([
      deps.paypal.createAuthorizeOrder(req, { source: "card" }),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs))),
    ]);
  } catch (e) {
    console.error("[spotter] example hold: PayPal failed:", e instanceof Error ? e.message : e);
    hold = null;
  } finally {
    clearTimeout(timer);
  }
  if (!hold?.authorizationId) {
    if (hold === null) console.error("[spotter] example hold: PayPal didn't answer in time or failed");
    else console.error("[spotter] example hold: PayPal gave no authorisation");
    return null;
  }
  return hold as Hold;
}

async function insertExample(
  db: Db,
  gran: Awaited<ReturnType<typeof listSpenders>>[number],
  req: PaymentRequest,
  hold: Hold,
  flags: Flag[],
  summary: string,
  wasItYou?: WasItYou,
): Promise<void> {
  const id = req.id;
  const ai: AiCheckResult = {
    ok: true,
    flags,
    dropped: 0,
    hidden: [],
    summary,
    injectionAttempt: false,
    ...(wasItYou ? { claimedSender: wasItYou.claim } : {}),
  };
  const allowance = { ...gran.allowance, spentThisWeek: { amount: 0, currency: gran.allowance.weekly.currency } };
  const decision = decide(checkRules(req, allowance), ai, { amount: req.money.amount, askAbove: allowance.askAbove.amount });
  await db.query(
    `insert into payments (id, spender_id, request, decision, ai, case_file, status, amount, currency,
       paypal_order_id, paypal_authorization_id, paypal_auth_expires_at, was_it_you)
     values ($1, $2, $3, $4, $5, $6, 'needs_approval', $7, $8, $9, $10, $11, $12)`,
    [
      id,
      gran.id,
      JSON.stringify(req),
      JSON.stringify(decision),
      JSON.stringify(ai),
      JSON.stringify(exampleCase(req.payee.name, hold.authorizationId, wasItYou ? { headline: `This looks like the Hi Mum scam. ${summary}` } : undefined)),
      req.money.amount,
      req.money.currency,
      hold.orderId,
      hold.authorizationId,
      hold.expiresAt ?? null,
      wasItYou ? JSON.stringify(wasItYou) : null,
    ],
  );
  await db.query("insert into events (payment_id, type, data) values ($1, 'example_created', $2)", [id, JSON.stringify({ orderId: hold.orderId })]);
  if (wasItYou) await db.query("insert into events (payment_id, type, data) values ($1, 'was_it_you_asked', $2)", [id, JSON.stringify({ who: wasItYou.who, channel: "example" })]);
}

/** The made up message for the "Was it you?" demo. Example data: Tom is the demo family's made up son. */
export const WAS_IT_YOU_EXAMPLE = {
  who: "Tom",
  payee: "jamie.k1994@mail.example",
  amount: 25000,
  context:
    "Forwarded from +44 7700 900183: Hi Mum it's Tom, new number. My phone broke and I can't get into my banking. Can you send £250 to my mate's account today? I'll pay you back tomorrow x jamie.k1994@mail.example",
};

const TOM_FLAGS: Flag[] = [
  { kind: "impersonation", severity: "high", quote: "it's Tom, new number", why: "Someone on a new number says they're Tom. That's how the Hi Mum scam starts." },
  { kind: "pressure", severity: "medium", quote: "today", why: "It has to be today, so there's no time to check." },
  { kind: "other", severity: "medium", quote: "send £250 to my mate's account", why: "The money goes to a friend's account, not to Tom." },
];

/** Gran's £250 for "Tom": the request behind both the seeded sample hold and the Was it you run. */
function tomRequest(id: string, spenderId: string): PaymentRequest {
  return {
    id,
    spenderId,
    money: { amount: WAS_IT_YOU_EXAMPLE.amount, currency: "GBP" },
    payee: { name: WAS_IT_YOU_EXAMPLE.payee, isNew: true },
    category: "family",
    method: "paypal_order",
    context: WAS_IT_YOU_EXAMPLE.context,
    createdAt: new Date().toISOString(),
  };
}

/** Most example holds one demo family can make in a day (each is a real sandbox authorisation). */
export const EXAMPLE_ASKS_PER_DAY = 12;

/**
 * The "Was it you?" demo: a real sandbox hold for the demo family's Gran, from a message that says it's Tom, and an
 * ask to Tom that the visitor answers on Tom's example phone (there is no real Tom to message). The claim is read by
 * the same code as a live check, so its quote is really in the message.
 */
export async function createWasItYouExample(
  deps: { db: Db; paypal: Pick<Deps["paypal"], "createAuthorizeOrder"> },
  householdId: string,
  waitMs = PAYPAL_WAIT_MS,
): Promise<{ paymentId: string; wasItYou: WasItYou } | "paypal_unavailable" | "no_relative" | "no_claim"> {
  const { db } = deps;
  const gran = (await listSpenders(db, householdId)).find((s) => s.kind === "person");
  if (!gran) return "no_relative";
  const claim = claimFromText(WAS_IT_YOU_EXAMPLE.context);
  if (!claim?.name) return "no_claim";
  const id = `pay_${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const req = tomRequest(id, gran.id);
  const hold = await holdAtPayPal(deps, req, waitMs);
  if (!hold) return "paypal_unavailable";
  const now = Date.now();
  const wasItYou: WasItYou = {
    id: `wiy_${randomBytes(9).toString("base64url")}`,
    claim,
    who: claim.name,
    target: { kind: "example", name: claim.name },
    channel: "example",
    state: "asked",
    askedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ANSWER_MINUTES * 60_000).toISOString(),
  };
  try {
    await insertExample(db, gran, req, hold, TOM_FLAGS, "Someone on a new number says they're Tom and wants £250 sent to a friend's account today.", wasItYou);
  } catch (e) {
    // The sandbox hold exists but nothing points at it: name it so it can be found, and say so to the caller.
    console.error(`[spotter] was it you demo: saving failed, sandbox authorisation ${hold.authorizationId} is orphaned (it expires on its own):`, e instanceof Error ? e.message : e);
    throw e;
  }
  return { paymentId: id, wasItYou };
}
