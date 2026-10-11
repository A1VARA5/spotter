// Telegram in. The same flow as email: a person connects their chat once with a SPOT- code, then forwards
// anything that asks them for money. Spotter reads the payment out of it, runs the full check (rules, AI,
// PayPal hold) and answers in the chat. The spotter's own chat gets a one tap Deny; approving still needs
// the PIN on the dashboard, so a lost phone or a hijacked chat can never pay anyone.
import type { Db } from "@/db";
import { deny, getPayment, getSpender, submitPayment, type Deps, type Spender } from "@/core/lifecycle";
import { findCode, redeemPairingCode } from "@/core/pairing";
import type { Extracted } from "@/ai/extract";
import { outcomeText } from "@/email/inbound";
import { checkWordsOnly, scanMessage } from "@/ai/scan";
import { blockedText, warnSpotter } from "@/core/switchedoff";
import { answerWasItYou, parseButton } from "@/core/was-it-you";
import type { ImageType } from "@/ai/screenshot";
import { savePending, screenshotText, takePending, type PictureChoice, type PictureRoute } from "@/core/picture";
import { captionAmount, householdCurrency, imageFrom, MAX_PHOTO_BYTES, photoMode, type PhotoAnswer, type PhotoInput, type PhotoResult } from "@/market/photo";
import { formatMoney, type Currency } from "@/core/types";

type TgEntity = { type: string; offset: number; length: number; url?: string };
export type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean; first_name?: string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id?: unknown; file_size?: unknown; width?: unknown; height?: unknown }>;
  document?: { file_id?: unknown; mime_type?: unknown; file_size?: unknown };
  forward_origin?: unknown;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  reply_markup?: { inline_keyboard?: Array<Array<{ text?: string; url?: string }>> };
};
export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number; type: string } } };
  /** The bot's own membership changed: in a private chat, "kicked" means the person blocked the bot. */
  my_chat_member?: { chat: { id: number; type: string }; from: { id: number }; date: number; old_chat_member: { status: string }; new_chat_member: { status: string } };
};

export type TgCtx = {
  deps: Deps;
  site: string;
  extract: (text: string) => Promise<Extracted>;
  send: (chatId: number | string, html: string, extra?: Record<string, unknown>) => Promise<void>;
  /** Answers a button press (the little toast in Telegram). Optional in tests. */
  answer?: (callbackId: string, text: string) => Promise<void>;
  /** Downloads a file Telegram holds (Bot API getFile), size checked; null when it can't. Photo checks need both of these. */
  download?: (fileId: string) => Promise<Buffer | null>;
  photoCheck?: (req: { householdId: string; input: PhotoInput }) => Promise<PhotoAnswer>;
  /** Decides where a picture goes (reads screenshots). Without it, every picture is a price check. */
  readPicture?: (req: { householdId: string; bytes: Buffer; type: ImageType; choice: PictureChoice | null }) => Promise<PictureRoute>;
};

export type TgOutcome =
  | "switched_off" | "ignored" | "duplicate" | "help" | "paired" | "unpaired" | "limited" | "unsupported" | "no_payment" | "scam_signs" | "checked"
  | "failed" | "denied" | "refused" | "not_me" | "it_was_me" | "photo_checked" | "photo_failed" | "asked" | "checked_words";

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
    "",
    "Screenshots work too: send me a screenshot of a text or an email and I'll read it and check it. Got a photo of a quote, an ad, or things someone wants to buy from you? Send it and I'll price each thing at real shops.",
  ].join("\n");
}

export async function handleTelegramUpdate(ctx: TgCtx, u: TgUpdate): Promise<TgOutcome> {
  const { db } = ctx.deps;
  if (u.callback_query) return handleButton(ctx, u.callback_query);
  if (u.my_chat_member) return handleMembership(ctx, u.update_id, u.my_chat_member);
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
    const paired = await redeemPairingCode(db, code, "telegram", chat, ctx.deps);
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

  // A forwarded message with words gets the full check on those words (a scam often comes with a picture); a photo
  // the person sends themselves, with or without a note, is priced.
  const picture = forwarded && text ? null : pictureIn(m);
  if (picture) {
    const householdId = spender?.household_id ?? spotterOf?.id;
    if (!householdId) {
      await say(HELP_UNPAIRED);
      return "unpaired";
    }
    await db.query("update inbound set sender = $2 where provider = 'telegram' and message_id = $1", [String(u.update_id), chat]);
    if (await overLimit(db, chat)) {
      await say("That's a lot of checks today. Please try again tomorrow, or ask your spotter.");
      return "limited";
    }
    if (!ctx.download || !ctx.photoCheck) {
      await say("I can't read pictures right now. Please copy the words of the message and send them to me instead. Nothing was paid.");
      return "unsupported";
    }
    if (picture === "refused") {
      await say("I can only check photos and screenshots (JPEG, PNG or WEBP) under 4 MB. Nothing was paid.");
      return "unsupported";
    }
    return handlePicture({ ...ctx, download: ctx.download, photoCheck: ctx.photoCheck }, say, { fileId: picture.fileId, householdId, spender, caption: text, chat, choice: null });
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

  const body = [text, hiddenLinks(m)].filter(Boolean).join("\n\n").slice(0, 50_000);
  return checkWords(ctx, say, spender, body, forwarded ? "forwarded" : "pasted", String(u.update_id));
}

/**
 * The full check on a message's words: read the ask out, run the check and PayPal hold, answer in the chat. The same
 * for words pasted, forwarded or read from a screenshot. retryKey: the update to forget on failure, so a retry works.
 */
async function checkWords(ctx: TgCtx, say: (html: string) => Promise<void>, spender: Spender, body: string, how: "forwarded" | "pasted" | "screenshot", retryKey?: string): Promise<TgOutcome> {
  const { db } = ctx.deps;
  let paymentId: string | null = null;
  try {
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
      context:
        how === "screenshot"
          ? `A screenshot ${spender.name} sent to Spotter on Telegram (the words were read from the picture):\n\n${body}`
          : `A message ${spender.name} ${how} to Spotter on Telegram:\n\n${body}`,
    });
    paymentId = p.id;
    const final = (await getPayment(db, p.id)) ?? p;
    const [head, ...rest] = outcomeText(final, spender, ctx.site).map(esc);
    await say([`<b>${head}</b>`, ...rest].join("\n\n"));
    return "checked";
  } catch (e) {
    console.error("[spotter] telegram check failed:", e instanceof Error ? e.message : e);
    if (!paymentId && retryKey) {
      // Nothing was created, so the same update can be tried again.
      await db.query("delete from inbound where provider = 'telegram' and message_id = $1", [retryKey]).catch((err) =>
        console.error("[spotter] couldn't forget the failed telegram update:", err instanceof Error ? err.message : err),
      );
    }
    await say(paymentId ? "Spotter checked this, but couldn't send the full answer. Your spotter can see it." : "Spotter couldn't check this right now. Nothing was paid. Try again in a few minutes.").catch((err) =>
      console.error("[spotter] telegram error reply failed:", err instanceof Error ? err.message : err),
    );
    return "failed";
  }
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const fileIdOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const sizeOk = (v: unknown) => v === undefined || (typeof v === "number" && v > 0 && v <= MAX_PHOTO_BYTES);

/** The photo to check: Telegram's largest size under the limit, or an image file. "refused" for other files or huge ones. */
function pictureIn(m: TgMessage): { fileId: string } | "refused" | null {
  if (Array.isArray(m.photo) && m.photo.length) {
    const fits = m.photo.filter((p) => p && fileIdOk(p.file_id) && sizeOk(p.file_size));
    const area = (p: (typeof fits)[number]) => (typeof p.width === "number" && typeof p.height === "number" ? p.width * p.height : 0);
    const best = fits.sort((a, b) => area(b) - area(a))[0];
    return best ? { fileId: best.file_id as string } : "refused";
  }
  const d = m.document;
  if (d) return fileIdOk(d.file_id) && typeof d.mime_type === "string" && IMAGE_TYPES.has(d.mime_type) && sizeOk(d.file_size) ? { fileId: d.file_id } : "refused";
  return null;
}

/** The answer as one Telegram message: a numbered line per thing, the total, the amount they named and a verdict. */
export function photoText(r: PhotoResult, captioned: boolean): string {
  const money = (minor: number) => formatMoney({ amount: minor, currency: r.currency });
  const whole = (minor: number) => money(minor).replace(/\.00$/, "");
  const lines = r.items.map((i) => {
    if (!i.found) return `${i.n}. ${esc(i.thing)}: couldn't find this one`;
    const range = i.low === i.high ? `about ${whole(i.low)}` : `${whole(i.low)} to ${whole(i.high)}`;
    const price =
      i.match === "similar"
        ? `similar ${r.mode === "buy" ? "ones" : "used ones"} mostly ${range}, not this exact one`
        : r.mode === "buy"
          ? `about ${whole(i.typical)} at real shops`
          : i.low === i.high
            ? `used ones sell for about ${whole(i.low)}`
            : `used ones sell for ${whole(i.low)} to ${whole(i.high)}`;
    return `${i.n}. ${esc(i.thing)}: ${price} (${esc(i.title.slice(0, 70))}, ${i.shops} ${i.shops === 1 ? "shop" : "shops"})`;
  });
  return [
    `<b>Photo price check${r.fallback ? " (whole photo)" : ""}</b>`,
    lines.join("\n"),
    `<b>${esc(r.total)}</b>${r.quote ? `\n${esc(r.quote)}` : ""}${r.verdict ? `\n${esc(r.verdict)}` : ""}`,
    "Prices come from real shop listings. Nothing was paid." + (captioned ? " This checked the things in the photo. To check a message, send me a screenshot of it on its own, or paste its words." : ""),
  ].join("\n\n");
}

type PictureCtx = TgCtx & Required<Pick<TgCtx, "download" | "photoCheck">>;
type PictureJob = { fileId: string; householdId: string; spender: Spender | null; caption: string; chat: string; choice: PictureChoice | null };

/**
 * One way in for every picture: a screenshot of a message is read and checked like pasted words, a photo of things is
 * priced, and an unclear one gets one question with two buttons. The picture lives only in memory for this call.
 */
async function handlePicture(ctx: PictureCtx, say: (html: string, extra?: Record<string, unknown>) => Promise<void>, p: PictureJob): Promise<TgOutcome> {
  try {
    const bytes = await ctx.download(p.fileId);
    if (!bytes) {
      await say("I couldn't get that picture from Telegram. Nothing was paid. Try sending it again.");
      return "photo_failed";
    }
    const img = imageFrom(bytes);
    if (!img) {
      await say("That file isn't a photo I can open (JPEG, PNG or WEBP under 4 MB). Nothing was paid.");
      return "photo_failed";
    }
    // Without a screenshot reader on this server, every picture is a price check, as before.
    const route: PictureRoute = ctx.readPicture ? await ctx.readPicture({ householdId: p.householdId, bytes: img.bytes, type: img.type, choice: p.choice }) : { route: "prices" };
    if (route.route === "error") {
      await say(esc(route.error));
      return "photo_failed";
    }
    if (route.route === "ask") {
      const token = await savePending(ctx.deps.db, { householdId: p.householdId, chat: p.chat, fileId: p.fileId, caption: p.caption });
      await say("Is this a message someone sent you, or things with prices (an ad, a quote, things for sale)?", {
        reply_markup: { inline_keyboard: [[{ text: "Check this message", callback_data: `pic:m:${token}` }, { text: "Check these prices", callback_data: `pic:p:${token}` }]] },
      });
      return "asked";
    }
    if (route.route === "message") {
      const body = [screenshotText(route.read), p.caption ? `[Note sent with the screenshot: ${p.caption.slice(0, 500)}]` : ""].filter(Boolean).join("\n\n");
      if (p.spender) return checkWords(ctx, say, p.spender, body, "screenshot");
      // The spotter's own screenshot: the check on its words, with nobody's money to hold.
      const r = await checkWordsOnly(ctx.deps.check, ctx.extract, body);
      await say([`<b>Read from your screenshot.</b> ${esc(r.text[0] ?? "")}`, ...r.text.slice(1).map(esc)].join("\n\n"));
      return "checked_words";
    }
    return await pricePhoto(ctx, say, { ...p, bytes: img.bytes });
  } catch (e) {
    console.error(`[spotter] telegram picture failed for ${p.householdId}:`, e instanceof Error ? e.message : e);
    await say("Spotter couldn't check this picture just now. Nothing was paid. Try again in a few minutes.").catch((err) =>
      console.error("[spotter] telegram error reply failed:", err instanceof Error ? err.message : err),
    );
    return "photo_failed";
  }
}

async function pricePhoto(ctx: PictureCtx, say: (html: string) => Promise<void>, p: PictureJob & { bytes: Buffer }): Promise<TgOutcome> {
  try {
    const currency: Currency = p.spender ? p.spender.allowance.weekly.currency : await householdCurrency(ctx.deps.db, p.householdId);
    const bytes = p.bytes;
    const r = await ctx.photoCheck({ householdId: p.householdId, input: { bytes, mode: photoMode(p.caption), currency, quoted: captionAmount(p.caption, currency) } });
    if (!r.ok) {
      await say(`${esc(r.error)} Nothing was paid.`);
      return "photo_failed";
    }
    await say(photoText(r.result, Boolean(p.caption)));
    return "photo_checked";
  } catch (e) {
    console.error(`[spotter] telegram photo check failed for ${p.householdId}:`, e instanceof Error ? e.message : e);
    await say("Spotter couldn't check this photo just now. Nothing was paid. Try again in a few minutes.").catch((err) =>
      console.error("[spotter] telegram error reply failed:", err instanceof Error ? err.message : err),
    );
    return "photo_failed";
  }
}

/** A protected person blocked the bot: Spotter can't answer them any more, which is exactly what a scammer wants. */
async function handleMembership(ctx: TgCtx, updateId: number, m: NonNullable<TgUpdate["my_chat_member"]>): Promise<TgOutcome> {
  const { db } = ctx.deps;
  if (m.chat.type !== "private" || m.new_chat_member.status !== "kicked") return "ignored";
  if (await seen(db, updateId)) return "duplicate";
  const spender = (await db.query<Spender>("select * from spenders where telegram_chat_id = $1", [String(m.chat.id)]))[0];
  if (!spender) return "ignored"; // the spotter's own alerts chat, or nobody Spotter knows
  try {
    await warnSpotter(ctx.deps, spender.household_id, `blocked:telegram:${updateId}`, { kind: "chat_blocked", text: blockedText(spender.name) });
  } catch (e) {
    // Not stored: forget the update so Telegram's retry (or a replay) gets a real second chance.
    console.error(`[spotter] couldn't store the blocked chat warning for ${spender.id} in ${spender.household_id}:`, e instanceof Error ? e.message : e);
    await db.query("delete from inbound where provider = 'telegram' and message_id = $1", [String(updateId)]).catch(() => {});
    return "failed";
  }
  return "switched_off";
}

async function handleButton(ctx: TgCtx, q: NonNullable<TgUpdate["callback_query"]>): Promise<TgOutcome> {
  const { db } = ctx.deps;
  const answer = (t: string) => ctx.answer?.(q.id, t) ?? Promise.resolve();
  const chat = String(q.message?.chat.id ?? q.from.id);
  // "Was it you?": bound to this chat (it must be the asked person's own) and to a signed single use token.
  const wiy = parseButton(q.data);
  if (wiy) {
    try {
      const r = await answerWasItYou(ctx.deps, { token: wiy.token, answer: wiy.answer, as: { channel: "telegram", id: chat } });
      await answer(r.ok ? (wiy.answer === "not_me" ? "Thanks. Answer saved." : "Noted. Nothing is paid.") : "Nothing changed.");
      await ctx.send(chat, esc(r.reply));
      return r.ok ? wiy.answer : "refused";
    } catch (e) {
      console.error("[spotter] telegram was it you? answer failed:", e instanceof Error ? e.message : e);
      await answer("Spotter couldn't save that.").catch(() => {});
      await ctx
        .send(chat, "Spotter couldn't save your answer just now. Nothing was paid. Press the button again in a moment.")
        .catch((err) => console.error("[spotter] telegram error reply failed:", err instanceof Error ? err.message : err));
      return "failed";
    }
  }
  // "Message or prices?": answers the question about a picture sent in this same chat, once.
  const pic = /^pic:(m|p):([a-f0-9]{24})$/.exec(q.data ?? "");
  if (pic) {
    const waiting = await takePending(db, pic[2]!, chat);
    if (!waiting || !ctx.download || !ctx.photoCheck) {
      await answer("That question has expired. Send the picture again.");
      return "refused";
    }
    await answer(pic[1] === "m" ? "Checking the message" : "Checking the prices");
    const spender = (await db.query<Spender>("select * from spenders where telegram_chat_id = $1 and household_id = $2", [chat, waiting.householdId]))[0] ?? null;
    const say = (html: string, extra: Record<string, unknown> = {}) => ctx.send(chat, html, { link_preview_options: { is_disabled: true }, ...extra });
    return handlePicture({ ...ctx, download: ctx.download, photoCheck: ctx.photoCheck }, say, {
      fileId: waiting.fileId,
      householdId: waiting.householdId,
      spender,
      caption: waiting.caption,
      chat,
      choice: pic[1] === "m" ? "message" : "prices",
    });
  }
  const id = /^deny:(pay_[a-z0-9]+)$/.exec(q.data ?? "")?.[1];
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
