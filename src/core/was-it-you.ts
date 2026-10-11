// "Was it you?": a held payment's message says it's from Tom, so Spotter asks the real Tom on the channel he
// already linked. "Not me" releases the PayPal hold straight away (the safe direction needs no PIN, but the button
// is bound to Tom's own chat or a signed single use token). "Yes, it's me" never pays anything: it's written on
// the case file and the spotter still approves with the PIN.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/db";
import { formatMoney } from "./types";
import { claimFromText, matchClaim, type Claim, type Target } from "./claim";
import { deny, getPayment, getSpender, type Deps, type Payment, type Spender } from "./lifecycle";

export { claimFromText, groundClaim, matchClaim, type Claim, type Target } from "./claim";

export type WasItYouState = "asked" | "no_channel" | "send_failed" | "not_me" | "it_was_me";
export type WasItYouChannel = "telegram" | "discord" | "email" | "alert" | "example";
export type WasItYou = {
  id: string;
  claim: Claim;
  /** The real person's name, as the family has it. */
  who: string;
  target: Target;
  /** Where the question went. "alert": merged into the spotter's own alert. null: they have nowhere linked. */
  channel: WasItYouChannel | null;
  state: WasItYouState;
  askedAt: string;
  expiresAt: string;
  answeredAt?: string;
};

/** How long a "Not me" or "Yes, it's me" button works. */
export const ANSWER_MINUTES = 60;

/** Who pressed the button: a chat id checked against the person's linked chat, a bare token (email), or the demo. */
export type Answerer = { channel: "telegram" | "discord"; id: string } | { channel: "link" } | { channel: "example"; householdId: string };
export type Answer = "not_me" | "it_was_me";
export type AnswerResult = { ok: boolean; reply: string; payment?: Payment; code?: "invalid" | "answered" | "expired" };

const amountOf = (p: Payment) => formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" });

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return createHash("sha256").update(`was-it-you:${s}`).digest();
}

const targetKey = (t: Target) => (t.kind === "spender" ? `spender:${t.spenderId}` : `${t.kind}:${t.name}`);
const sign = (w: Pick<WasItYou, "id" | "target">, paymentId: string) =>
  createHmac("sha256", key()).update(`wiy|${w.id}|${paymentId}|${targetKey(w.target)}`).digest("base64url").slice(0, 22);

/** The token on the buttons: the ask's id and a signature bound to this payment and this person. Fits in Telegram's 64 bytes. */
export const tokenFor = (w: Pick<WasItYou, "id" | "target">, paymentId: string) => `${w.id}.${sign(w, paymentId)}`;

async function event(db: Db, paymentId: string, type: string, data: Record<string, unknown> = {}) {
  await db.query("insert into events (payment_id, type, data) values ($1, $2, $3)", [paymentId, type, JSON.stringify(data)]);
}

async function save(db: Db, id: string, w: WasItYou): Promise<Payment | null> {
  return (await db.query<Payment>("update payments set was_it_you = $2 where id = $1 returning *", [id, JSON.stringify(w)]))[0] ?? null;
}

type HouseholdRow = { id: string; spotter_name: string; telegram_chat_id: string | null; discord_user_id: string | null; alert_email: string | null };

/** Works out who to ask (if anyone) and stores the ask on the payment. Doesn't send anything. */
export async function planWasItYou(db: Db, payment: Payment, payer: Spender): Promise<{ w: WasItYou; payment: Payment; to: Spender | null } | null> {
  if (payer.kind === "agent" || payment.status !== "needs_approval" || payment.was_it_you) return null;
  // The AI check grounds its own claim and falls back to code's patterns; rows without a check use the patterns.
  const claim = payment.ai && "claimedSender" in payment.ai ? (payment.ai.claimedSender ?? null) : claimFromText(payment.request.context);
  if (!claim) return null;
  const [hh] = await db.query<HouseholdRow>(
    "select id, spotter_name, telegram_chat_id, discord_user_id, alert_email from households where id = $1",
    [payer.household_id],
  );
  if (!hh) return null;
  const spenders = await db.query<Spender>("select * from spenders where household_id = $1", [hh.id]);
  const target = matchClaim(claim, { household: hh, spenders, payer });
  if (!target) return null;

  const to = target.kind === "spender" ? (spenders.find((s) => s.id === target.spenderId) ?? null) : null;
  const channel: WasItYouChannel | null =
    target.kind === "spotter" ? "alert" : to?.telegram_chat_id ? "telegram" : to?.discord_user_id ? "discord" : to?.email ? "email" : null;
  const now = Date.now();
  const w: WasItYou = {
    id: `wiy_${randomBytes(9).toString("base64url")}`,
    claim,
    who: target.name,
    target,
    channel,
    state: channel ? "asked" : "no_channel",
    askedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ANSWER_MINUTES * 60_000).toISOString(),
  };
  const rows = await db.query<Payment>("update payments set was_it_you = $2 where id = $1 and was_it_you is null returning *", [payment.id, JSON.stringify(w)]);
  if (!rows[0]) return null;
  return { w, payment: rows[0], to };
}

/**
 * Plans the ask and sends it to the real person. Never throws and never changes the payment's status: whatever
 * goes wrong is written down (state send_failed, an event) so the spotter's alert can say "ring Tom yourself".
 */
export async function startWasItYou(deps: Deps, payment: Payment, payer: Spender): Promise<Payment> {
  const { db } = deps;
  try {
    const plan = await planWasItYou(db, payment, payer);
    if (!plan) return payment;
    const { w, to } = plan;
    if (w.state === "no_channel") {
      await event(db, payment.id, "was_it_you_no_channel", { who: w.who });
      return plan.payment;
    }
    if (w.channel === "alert") {
      // The spotter is the person named: their alert carries the question, no second message.
      await event(db, payment.id, "was_it_you_asked", { who: w.who, channel: "alert" });
      return plan.payment;
    }
    let sendError: string | null = null;
    try {
      if (!deps.ask || !to) throw new Error(`no way to send on ${w.channel}`);
      await deps.ask(plan.payment, payer, w, to);
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    }
    if (sendError === null) {
      // Sent: a failed log line must not turn it into "couldn't reach Tom" (his buttons work).
      await event(db, payment.id, "was_it_you_asked", { who: w.who, channel: w.channel }).catch((e) =>
        console.error(`[spotter] was it you? event for ${payment.id} failed:`, e instanceof Error ? e.message : e),
      );
      return plan.payment;
    }
    console.error(`[spotter] was it you? ask for ${payment.id} failed: ${sendError}`);
    await event(db, payment.id, "was_it_you_failed", { who: w.who, channel: w.channel, error: sendError }).catch((e) =>
      console.error(`[spotter] was it you? event for ${payment.id} failed:`, e instanceof Error ? e.message : e),
    );
    return (await save(db, payment.id, { ...w, state: "send_failed" })) ?? plan.payment;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[spotter] was it you? for ${payment.id} failed: ${error}`);
    await event(db, payment.id, "was_it_you_failed", { error }).catch((err) =>
      console.error(`[spotter] was it you? event for ${payment.id} failed:`, err instanceof Error ? err.message : err),
    );
    // An ask that may be stored as "asked" but never went out must not say "waiting for Tom".
    await db
      .query("update payments set was_it_you = was_it_you || '{\"state\":\"send_failed\"}'::jsonb where id = $1 and was_it_you->>'state' = 'asked' and was_it_you->>'channel' <> 'alert'", [payment.id])
      .catch((err) => console.error(`[spotter] was it you? couldn't mark ${payment.id} send_failed:`, err instanceof Error ? err.message : err));
    return (await db.query<Payment>("select * from payments where id = $1", [payment.id]).catch(() => []))[0] ?? payment;
  }
}

const sameSig = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** May this presser answer this ask? Bound to the channel the question went to, and to that person's own chat. */
async function allowed(db: Db, p: Payment, w: WasItYou, as: Answerer): Promise<boolean> {
  if (w.channel === "example") {
    if (as.channel !== "example") return false;
    const [own] = await db.query("select 1 from spenders where id = $1 and household_id = $2", [p.spender_id, as.householdId]);
    return Boolean(own);
  }
  if (w.channel === "email") return as.channel === "link";
  if (as.channel !== "telegram" && as.channel !== "discord") return as.channel === "link" && w.channel === "alert";
  const col = as.channel === "telegram" ? "telegram_chat_id" : "discord_user_id";
  if (w.channel === "alert") {
    const [hh] = await db.query<{ v: string | null }>(
      `select h.${col} as v from households h join spenders s on s.household_id = h.id where s.id = $1`,
      [p.spender_id],
    );
    return Boolean(hh?.v) && hh!.v === as.id;
  }
  if (w.channel !== as.channel || w.target.kind !== "spender") return false;
  const [s] = await db.query<{ v: string | null }>(`select ${col} as v from spenders where id = $1`, [w.target.spenderId]);
  return Boolean(s?.v) && s!.v === as.id;
}

/** Finds the ask behind a token and checks its signature. null for anything forged, mixed up or unknown. */
export async function findAsk(db: Db, token: string): Promise<{ p: Payment; w: WasItYou } | null> {
  const m = /^(wiy_[A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{22})$/.exec(token ?? "");
  if (!m) return null;
  const [p] = await db.query<Payment>("select * from payments where was_it_you->>'id' = $1", [m[1]]);
  const w = p?.was_it_you;
  if (!p || !w) return null;
  return sameSig(m[2]!, sign(w, p.id)) ? { p, w } : null;
}

/** Best effort note to the spotter. True only when at least one channel took it. The answer already stands. */
async function tellSpotter(deps: Deps, p: Payment, payer: Spender | null, text: string): Promise<boolean> {
  let delivered = false;
  try {
    if (deps.note && payer) delivered = (await deps.note(p, payer, text)) === true;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[spotter] was it you? note for ${p.id} failed: ${error}`);
  }
  // Written on the timeline either way, so the dashboard has it even when no message got through.
  await event(deps.db, p.id, delivered ? "spotter_noted" : "note_failed", { text }).catch((e) =>
    console.error(`[spotter] was it you? note event for ${p.id} failed:`, e instanceof Error ? e.message : e),
  );
  return delivered;
}

/** What a payment's status really means, for replies. */
function statusWords(status: string): string {
  switch (status) {
    case "captured":
      return "already paid";
    case "capturing":
      return "being paid right now";
    case "voided":
      return "already stopped, nothing was paid";
    case "voiding":
      return "being released right now, nothing was paid";
    case "blocked":
    case "protected":
      return "already stopped, nothing was paid";
    case "failed":
      return "not paid (it didn't go through)";
    default:
      return status;
  }
}

export async function answerWasItYou(deps: Deps, input: { token: string; answer: Answer; as: Answerer }): Promise<AnswerResult> {
  const { db } = deps;
  const found = await findAsk(db, input.token);
  if (!found || !(await allowed(db, found.p, found.w, input.as))) return { ok: false, code: "invalid", reply: "That button isn't valid for you. Nothing changed." };
  const { p: before, w } = found;
  const who = w.who;
  if (w.state === "not_me" || w.state === "it_was_me") {
    return { ok: false, code: "answered", reply: `You already answered: ${w.state === "not_me" ? "not me" : "it was me"}. Nothing else changed.`, payment: before };
  }
  if (w.state !== "asked") return { ok: false, code: "invalid", reply: "That button isn't valid for you. Nothing changed." };
  if (new Date(w.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: "expired", reply: "This question has expired, so nothing changed. If something looks wrong, ring the family on a number you already have.", payment: before };
  }

  // One conditional update: a double tap or a replayed token finds the state already moved and stops here.
  const answeredAt = new Date().toISOString();
  const [claimed] = await db.query<Payment>(
    `update payments set was_it_you = was_it_you || $3::jsonb where id = $1 and was_it_you->>'id' = $2 and was_it_you->>'state' = 'asked' returning *`,
    [before.id, w.id, JSON.stringify({ state: input.answer, answeredAt })],
  );
  if (!claimed) return { ok: false, code: "answered", reply: "You already answered. Nothing else changed.", payment: before };
  try {
    return await afterAnswer(deps, before, claimed, w, input.answer);
  } catch (e) {
    // Something broke after the answer was saved. Put the ask back so pressing again really retries, and say so.
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[spotter] was it you? answer for ${before.id} crashed: ${error}`);
    await db
      .query("update payments set was_it_you = was_it_you || '{\"state\":\"asked\"}'::jsonb - 'answeredAt' where id = $1 and status = 'needs_approval'", [before.id])
      .catch((err) => console.error(`[spotter] was it you? couldn't reopen ${before.id}:`, err instanceof Error ? err.message : err));
    await event(db, before.id, "was_it_you_crashed", { answer: input.answer, error }).catch((err) =>
      console.error(`[spotter] was it you? crash event for ${before.id} failed:`, err instanceof Error ? err.message : err),
    );
    const now = (await getPayment(db, before.id).catch(() => null)) ?? claimed;
    return {
      ok: false,
      reply:
        now.status === "needs_approval"
          ? "Spotter couldn't finish that. Nothing was paid and the money is still on hold. Press the button again in a moment."
          : `Spotter couldn't finish that. The payment is ${statusWords(now.status)}.`,
      payment: now,
    };
  }
}

async function afterAnswer(deps: Deps, before: Payment, claimed: Payment, w: WasItYou, answer: Answer): Promise<AnswerResult> {
  const { db } = deps;
  const who = w.who;
  await event(db, before.id, "was_it_you_answered", { who, answer });

  const payer = await getSpender(db, before.spender_id);
  const payerName = payer?.name ?? "they";
  const amount = amountOf(before);
  const payee = before.request.payee.name;
  const toSpotter = w.target.kind !== "spotter";
  const spotter = payer?.spotter_name ?? "The spotter";

  // Only claims the spotter was told when a message really went out.
  const told = (ok: boolean) => (ok ? `${spotter} has been told.` : `Spotter couldn't reach ${spotter}, so please ring them now.`);

  if (answer === "it_was_me") {
    if (claimed.status !== "needs_approval") {
      return { ok: true, reply: `Thanks, noted. This payment is ${statusWords(claimed.status)}, so your answer changed nothing.`, payment: claimed };
    }
    if (toSpotter) await tellSpotter(deps, claimed, payer, `${who} says they sent the message to ${payerName}. The ${amount} is still on hold: approve it with your PIN if you're happy.`);
    return {
      ok: true,
      reply: toSpotter
        ? `Thanks, noted on the case. Nothing is paid yet: ${spotter} still has to approve it with their PIN.`
        : "Noted on the case. Nothing is paid yet: approve it on the dashboard with your PIN if you're happy.",
      payment: claimed,
    };
  }

  // "Not me": release the hold if it's still held. Anything else, say what really happened.
  const status = claimed.status === "needs_approval" ? (await deny(deps, before.id, who)).status : claimed.status;
  const after = (await getPayment(db, before.id)) ?? claimed;
  const fresh = claimed.status === "needs_approval";
  if (status === "voided" || status === "voiding") {
    const released = status === "voided" ? "released" : "is releasing";
    if (toSpotter) await tellSpotter(deps, after, payer, `${who} says they didn't send the message to ${payerName}. ${fresh ? `Spotter ${released}` : "It was already stopped:"} the ${amount} to ${payee}. Nothing was paid.`);
    return {
      ok: true,
      reply: fresh ? `Thanks. ${payerName}'s ${amount} is safe: nothing was paid. Spotter is letting ${payerName} know it wasn't you.` : `Thanks. It was already stopped: nothing was paid to ${payee}.`,
      payment: after,
    };
  }
  if (status === "captured" || status === "capturing") {
    const ok = await tellSpotter(deps, after, payer, `Urgent: ${who} says they didn't send the message, but ${amount} to ${payee} is ${statusWords(status)}. Ring ${payerName} and report it to PayPal now.`);
    return { ok: true, reply: `Thanks. It was already approved: ${amount} to ${payee} is ${statusWords(status)}. ${told(ok)}`, payment: after };
  }
  if (fresh && status === "failed") {
    // The void call failed: Spotter marks it failed, so it will never pay it, but PayPal may still hold the money until the hold expires.
    const ok = await tellSpotter(deps, after, payer, `${who} says they didn't send the message, but PayPal didn't confirm releasing the ${amount} hold for ${payee}. Spotter won't pay it. PayPal drops the hold on its own, or you can cancel it in PayPal.`);
    return { ok: true, reply: `Thanks. Spotter will never pay this, but PayPal didn't confirm releasing the hold yet, so the money may stay held for a while. ${told(ok)}`, payment: after };
  }
  if (toSpotter) await tellSpotter(deps, after, payer, `${who} says they didn't send the message to ${payerName}. The payment is ${statusWords(status)}.`);
  return { ok: true, reply: `Thanks. The payment is ${statusWords(status)}.`, payment: after };
}

/** One line for the case file and alerts, in plain words. */
export function wasItYouLine(w: WasItYou | null | undefined): string | null {
  if (!w) return null;
  switch (w.state) {
    case "asked":
      return w.channel === "alert" ? `It says it's from you (${w.who}). Was it you?` : `Spotter asked ${w.who} if they sent it. Waiting for an answer.`;
    case "not_me":
      return `${w.who}: not me. The message wasn't from ${w.who}.`;
    case "it_was_me":
      return `${w.who}: it was me. ${w.who} says they sent it. It still needs your PIN to pay.`;
    case "no_channel":
      return `It says it's from ${w.who}, but ${w.who} has nothing linked to Spotter. Ring ${w.who} on the number you already have.`;
    case "send_failed":
      return `It says it's from ${w.who}. Spotter couldn't reach ${w.who}, so ring them on the number you already have.`;
  }
}

/** The question, in plain words: the line itself, then the words the message used. Each channel formats these. */
export function askLines(p: Payment, payer: Pick<Spender, "name">, w: WasItYou): [string, string] {
  const fresh = /\bnew (?:number|phone)\b/i.test(p.request.context ?? "") ? " from a new number" : "";
  return [`Did you message ${payer.name}${fresh} asking for ${amountOf(p)}?`, `The message says "${w.claim.quote}".`];
}

/** Telegram and Discord button ids: "wiy:n:<token>" or "wiy:y:<token>". */
export const buttonId = (answer: Answer, token: string) => `wiy:${answer === "not_me" ? "n" : "y"}:${token}`;
export function parseButton(id: string | undefined): { answer: Answer; token: string } | null {
  const m = /^wiy:([ny]):(\S{1,60})$/.exec(id ?? "");
  return m ? { answer: m[1] === "n" ? "not_me" : "it_was_me", token: m[2]! } : null;
}

/** What the person who wanted to pay hears after "Not me". */
export const notMeText = (w: WasItYou, p: Payment) =>
  `It wasn't ${w.who}. Your ${amountOf(p)} is safe. Ring ${w.who} on the number you already have.`;
