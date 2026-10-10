// Telegram in. The same flow as email: a person connects their chat once with a SPOT- code, then forwards
// anything that asks them for money. Spotter reads the payment out of it, runs the full check (rules, AI,
// PayPal hold) and answers in the chat. The spotter's own chat gets a one tap Deny; approving still needs
// the PIN on the dashboard, so a lost phone or a hijacked chat can never pay anyone.
import type { Db } from "@/db";
import { deny, getPayment, getSpender, submitPayment, type Deps, type Spender } from "@/core/lifecycle";
import { findCode, redeemPairingCode } from "@/core/pairing";
import type { Extracted } from "@/ai/extract";
import { outcomeText } from "@/email/inbound";
import { scanMessage } from "@/ai/scan";

type TgEntity = { type: string; offset: number; length: number; url?: string };
export type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean; first_name?: string };
  text?: string;
  caption?: string;
  photo?: unknown[];
  document?: unknown;
  forward_origin?: unknown;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  reply_markup?: { inline_keyboard?: Array<Array<{ text?: string; url?: string }>> };
};
export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number; type: string } } };
};

export type TgCtx = {
  deps: Deps;
  site: string;
  extract: (text: string) => Promise<Extracted>;
  send: (chatId: number | string, html: string, extra?: Record<string, unknown>) => Promise<void>;
  /** Answers a button press (the little toast in Telegram). Optional in tests. */
  answer?: (callbackId: string, text: string) => Promise<void>;
};

export type TgOutcome = "ignored" | "duplicate" | "help" | "paired" | "unpaired" | "limited" | "unsupported" | "no_payment" | "scam_signs" | "checked" | "failed" | "denied" | "refused";

const PER_CHAT_PER_DAY = 12;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram hides link targets in entities and buttons. They go into the text so the check sees them. */
function hiddenLinks(t: TgMessage): string {
  const shown = t.text ?? t.caption ?? "";
  const out: string[] = [];
  for (const e of [...(t.entities ?? []), ...(t.caption_entities ?? [])]) {
    if (e.type === "text_link" && e.url) out.push(`[The words "${shown.slice(e.offset, e.offset + e.length).slice(0, 100)}" link to: ${e.url}]`);
  }
  for (const row of t.reply_markup?.inline_keyboard ?? []) for (const b of row) if (b.url) out.push(`[Button "${(b.text ?? "").slice(0, 60)}" links to: ${b.url}]`);
  return out.slice(0, 12).join("\n");
}

async function seen(db: Db, updateId: number): Promise<boolean> {
  const rows = await db.query("insert into inbound (provider, message_id) values ('telegram', $1) on conflict do nothing returning message_id", [String(updateId)]);
  return rows.length === 0;
}

async function overLimit(db: Db, chat: string): Promise<boolean> {
  const [r] = await db.query<{ n: string }>(
    "select count(*)::text as n from inbound where provider = 'telegram' and sender = $1 and received_at > now() - interval '1 day'",
    [chat],
  );
  return Number(r?.n ?? 0) > PER_CHAT_PER_DAY;
}

const HELP_UNPAIRED = [
  "<b>Spotter</b> gives your family a second look before money goes.",
  "",
  "To connect, open the link your spotter sent you, or send me the code they gave you (it starts with SPOT-).",
].join("\n");

function helpFor(s: Spender) {
  return [
    `<b>You're connected to Spotter, ${esc(s.name)}.</b>`,
    "",
    "When a text, a message app or an email asks you for money, forward it here or paste it in. I check it, and if anything looks off, PayPal holds the money until " +
      `${esc(s.spotter_name)} says yes.`,
  ].join("\n");
}

export async function handleTelegramUpdate(ctx: TgCtx, u: TgUpdate): Promise<TgOutcome> {
  const { db } = ctx.deps;
  if (u.callback_query) return handleButton(ctx, u.callback_query);
  const m = u.message;
  if (!m || m.from?.is_bot || m.chat.type !== "private") return "ignored";
  if (await seen(db, u.update_id)) return "duplicate";
  const chat = String(m.chat.id);
  const say = (html: string, extra: Record<string, unknown> = {}) =>
    ctx.send(chat, html, { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true }, link_preview_options: { is_disabled: true }, ...extra });

  const text = (m.text ?? m.caption ?? "").trim();
  const forwarded = Boolean(m.forward_origin);
  const spender = (await db.query<Spender>("select * from spenders where telegram_chat_id = $1", [chat]))[0] ?? null;
  const spotterOf = (await db.query<{ id: string; spotter_name: string }>("select id, spotter_name from households where telegram_chat_id = $1", [chat]))[0];

  // A code counts only in the person's own words, never inside something they forwarded.
  const code = forwarded ? null : findCode(text);
  if (code) {
    const paired = await redeemPairingCode(db, code, "telegram", chat);
    if (!paired) {
      await say("That code didn't work. It may be used or more than a day old. Ask your spotter for a new one.");
      return "unpaired";
    }
    await say(
      paired.spender
        ? `<b>${esc(paired.spender.name)} is connected to Spotter.</b>\n\nFrom now on, forward me anything that asks you for money. I'll check it and tell you here.`
        : "<b>You're connected.</b> When someone's payment needs you, Spotter tells you here, with a button to deny it straight away.",
    );
    return "paired";
  }

  if (/^\/(start|help)\b/i.test(text)) {
    await say(spender ? helpFor(spender) : spotterOf ? "You're connected as the spotter. Payments that need you will show up here." : HELP_UNPAIRED);
    return "help";
  }
  if (!spender) {
    await say(spotterOf ? "This chat gets your alerts. To check a payment, the person paying forwards it from their own Telegram." : HELP_UNPAIRED);
    return "unpaired";
  }
  await db.query("update inbound set sender = $2 where provider = 'telegram' and message_id = $1", [String(u.update_id), chat]);
  if (await overLimit(db, chat)) {
    await say("That's a lot of checks today. Please try again tomorrow, or ask your spotter.");
    return "limited";
  }
  if (!text && (m.photo || m.document)) {
    await say("I can't read pictures or files yet. Please copy the words of the message and send them to me instead. Nothing was paid.");
    return "unsupported";
  }

  let paymentId: string | null = null;
  try {
    const body = [text, hiddenLinks(m)].filter(Boolean).join("\n\n").slice(0, 50_000);
    const found = await ctx.extract(body);
    if (!found.ok) throw new Error(`extraction failed: ${found.error}`);
    if (!found.found) {
      // No amount yet, but lures (fake trading groups, "you've won") still deserve a straight answer.
      const scan = await scanMessage(ctx.deps.check, body);
      await say(scan.text.map((line, i) => (i === 0 ? `<b>${esc(line)}</b>` : esc(line))).join("\n\n"));
      return scan.signs ? "scam_signs" : "no_payment";
    }
    const p = await submitPayment(ctx.deps, {
      spenderId: spender.id,
      money: { amount: found.amountPence, currency: found.currency },
      payee: { name: found.payee, isNew: true },
      category: found.category,
      method: found.method,
      item: found.item,
      context: `A message ${spender.name} ${forwarded ? "forwarded" : "pasted"} to Spotter on Telegram:\n\n${body}`,
    });
    paymentId = p.id;
    const final = (await getPayment(db, p.id)) ?? p;
    const [head, ...rest] = outcomeText(final, spender, ctx.site).map(esc);
    await say([`<b>${head}</b>`, ...rest].join("\n\n"));
    return "checked";
  } catch (e) {
    console.error("[spotter] telegram check failed:", e instanceof Error ? e.message : e);
    if (!paymentId) {
      // Nothing was created, so the same update can be tried again.
      await db.query("delete from inbound where provider = 'telegram' and message_id = $1", [String(u.update_id)]).catch(() => {});
    }
    await say(paymentId ? "Spotter checked this, but couldn't send the full answer. Your spotter can see it." : "Spotter couldn't check this right now. Nothing was paid. Try again in a few minutes.").catch((err) =>
      console.error("[spotter] telegram error reply failed:", err instanceof Error ? err.message : err),
    );
    return "failed";
  }
}

async function handleButton(ctx: TgCtx, q: NonNullable<TgUpdate["callback_query"]>): Promise<TgOutcome> {
  const { db } = ctx.deps;
  const answer = (t: string) => ctx.answer?.(q.id, t) ?? Promise.resolve();
  const id = /^deny:(pay_[a-z0-9]+)$/.exec(q.data ?? "")?.[1];
  const chat = String(q.message?.chat.id ?? q.from.id);
  if (!id) {
    await answer("That button has expired.");
    return "refused";
  }
  // Only the chat the spotter connected for this household may deny its payments.
  const rows = await db.query<{ household_id: string; spotter_name: string }>(
    "select h.id as household_id, h.spotter_name from payments p join spenders s on s.id = p.spender_id join households h on h.id = s.household_id where p.id = $1 and h.telegram_chat_id = $2",
    [id, chat],
  );
  const own = rows[0];
  if (!own) {
    await answer("Only the spotter's own chat can do that.");
    return "refused";
  }
  const before = await getPayment(db, id);
  if (before?.status !== "needs_approval") {
    await answer(`Already ${before?.status === "voided" ? "denied" : before?.status === "captured" ? "approved" : "decided"}.`);
    return "refused";
  }
  const after = await deny(ctx.deps, id, own.spotter_name);
  await answer(after.status === "voided" ? "Denied. PayPal released the hold." : "PayPal couldn't release it. Check the dashboard.");
  if (after.status === "voided") {
    const spender = await getSpender(db, after.spender_id);
    await ctx.send(chat, `<b>Denied.</b> PayPal released the hold on ${esc(after.request.payee.name)}. Nothing was paid${spender ? `, and ${esc(spender.name)} has been told` : ""}.`);
  }
  return after.status === "voided" ? "denied" : "failed";
}
