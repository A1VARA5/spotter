// The demo family's example hold: so a judge sees a real hold straight away without spending a send.
// The money part is real (a PayPal sandbox authorisation, free to make, and approve or deny capture or void
// it for real). The check and the case file were written earlier and are labelled that way, never passed off
// as a live check. If PayPal is down or slow, the family starts without it.
import type { Db } from "@/db";
import type { AiCheckResult } from "@/ai/check";
import { decide } from "@/core/decide";
import type { Flag } from "@/core/grounding";
import { listSpenders } from "@/core/households";
import type { Deps } from "@/core/lifecycle";
import { checkRules } from "@/core/rules";
import type { PaymentRequest } from "@/core/types";
import type { Case } from "@/agents/case";
import { SCENARIOS } from "@/ui/scenarios";

export const EXAMPLE_LABEL = "Example, checked earlier";
const PAYPAL_WAIT_MS = 5000;

const hiMum = SCENARIOS.find((s) => s.id === "gran-hi-mum")!;

const FLAGS: Flag[] = [
  { kind: "impersonation", severity: "high", quote: "Hi mum its me, new number", why: "Someone texting from a new number says they're family. That's how the Hi Mum scam starts." },
  { kind: "pressure", severity: "medium", quote: "has to be paid today", why: "It has to be paid today, so there's no time to check." },
  { kind: "other", severity: "medium", quote: "send £250 to my mate Jamie's PayPal", why: "The money goes to a friend's account, not to the person asking." },
];

function exampleCase(payee: string, authorizationId: string): Case {
  const calls = [
    { id: "example_history", tool: "payee_history", args: { payee }, ok: true, summary: `Gran has never paid ${payee}.` },
    { id: "example_hold", tool: "paypal_hold", args: { authorizationId }, ok: true, summary: "PayPal is holding £250.00. Nothing is paid until you approve." },
  ];
  return {
    status: "done",
    verdict: "likely_scam",
    headline: `${EXAMPLE_LABEL}: this looks like the Hi Mum scam. Someone says they're family on a new number and wants £250 sent to a friend's account today.`,
    findings: [
      { text: `Gran has never paid ${payee} before.`, tool: "payee_history", source: "example_history" },
      { text: "PayPal is holding the £250 in the sandbox. Deny releases it, approve pays it.", tool: "paypal_hold", source: "example_hold" },
    ],
    ask: ["Ring your son or daughter on the number you already have for them and ask if they sent this.", "Don't reply to the new number or call it back."],
    calls,
    dropped: 0,
    model: "example",
    ms: 0,
    example: true,
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
  const b = hiMum.body;
  const req: PaymentRequest = {
    id,
    spenderId: gran.id,
    money: { amount: b.amount, currency: b.currency },
    payee: { name: b.payee, isNew: true },
    category: b.category,
    method: b.method,
    context: b.context,
    createdAt: new Date().toISOString(),
  };

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
    if (hold === null) console.error("[spotter] example hold: PayPal didn't answer in time or failed, starting without it");
    else console.error("[spotter] example hold: PayPal gave no authorisation, starting without it");
    return "paypal_unavailable";
  }

  const ai: AiCheckResult = {
    ok: true,
    flags: FLAGS,
    dropped: 0,
    hidden: [],
    summary: `${EXAMPLE_LABEL}. Someone pretending to be family on a new number, in a hurry, asking for money for a friend's account.`,
    injectionAttempt: false,
  };
  const allowance = { ...gran.allowance, spentThisWeek: { amount: 0, currency: gran.allowance.weekly.currency } };
  const decision = decide(checkRules(req, allowance), ai, { amount: req.money.amount, askAbove: allowance.askAbove.amount });
  await db.query(
    `insert into payments (id, spender_id, request, decision, ai, case_file, status, amount, currency,
       paypal_order_id, paypal_authorization_id, paypal_auth_expires_at)
     values ($1, $2, $3, $4, $5, $6, 'needs_approval', $7, $8, $9, $10, $11)`,
    [
      id,
      gran.id,
      JSON.stringify(req),
      JSON.stringify(decision),
      JSON.stringify(ai),
      JSON.stringify(exampleCase(b.payee, hold.authorizationId)),
      req.money.amount,
      req.money.currency,
      hold.orderId,
      hold.authorizationId,
      hold.expiresAt ?? null,
    ],
  );
  await db.query("insert into events (payment_id, type, data) values ($1, 'example_created', $2)", [id, JSON.stringify({ orderId: hold.orderId })]);
  return "created";
}
