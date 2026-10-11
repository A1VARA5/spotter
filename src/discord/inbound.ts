// Discord in. Same flow as email and Telegram: connect once with /spotter connect and a SPOT- code, then
// right click any message that asks for money and pick "Check with Spotter". Replies are private (ephemeral).
// The spotter's alert DM has a Deny button; approving needs the PIN on the dashboard.
import { deny, getPayment, getSpender, submitPayment, type Deps, type Spender } from "@/core/lifecycle";
import { findCode, redeemPairingCode } from "@/core/pairing";
import type { Extracted } from "@/ai/extract";
import { outcomeText } from "@/email/inbound";
import { scanMessage } from "@/ai/scan";
import { formatMoney } from "@/core/types";
import { answerWasItYou, parseButton } from "@/core/was-it-you";

type Embed = { title?: string; description?: string; url?: string; fields?: Array<{ name?: string; value?: string }>; author?: { name?: string; url?: string }; footer?: { text?: string } };
type Component = { url?: string; label?: string; components?: Component[] };
export type DcMessage = { content: string; embeds?: Embed[]; components?: Component[]; message_snapshots?: Array<{ message?: DcMessage }> };
type Option = { type?: number; name: string; value?: string; options?: Option[] };
export type Interaction = {
  type: number;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { type?: number; name?: string; custom_id?: string; target_id?: string; options?: Option[]; resolved?: { messages?: Record<string, DcMessage> } };
};
export type DcCtx = { deps: Deps; site: string; extract: (text: string) => Promise<Extracted> };
export type DcReply = { content: string; components?: unknown[] };

const PER_USER_PER_DAY = 12;
const cut = (s: string, n = 1900) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Everything a message shows, including embeds, link buttons and a forwarded original. */
export function readMessage(msg: DcMessage): string {
  const embeds = (msg.embeds ?? [])
    .map((e) => [e.author?.name, e.author?.url, e.title, e.description, e.url, ...(e.fields ?? []).flatMap((f) => [f.name, f.value]), e.footer?.text].filter(Boolean).join("\n"))
    .join("\n");
  const buttons: string[] = [];
  const walk = (cs?: Component[]) => cs?.forEach((c) => (c.url ? buttons.push(`[Button "${(c.label ?? "").slice(0, 60)}" links to: ${c.url}]`) : walk(c.components)));
  walk(msg.components);
  const forwarded = (msg.message_snapshots ?? []).flatMap((s) => (s.message ? [readMessage(s.message)] : []));
  return [msg.content, embeds, buttons.slice(0, 12).join("\n"), ...forwarded].filter(Boolean).join("\n\n");
}

const NOT_CONNECTED = "You're not connected to Spotter yet. Ask your spotter for a code, then type `/spotter connect` and paste it in.";

async function checkMessage(ctx: DcCtx, spender: Spender, text: string): Promise<DcReply> {
  const { db } = ctx.deps;
  const [r] = await db.query<{ n: string }>(
    "select count(*)::text as n from payments where spender_id = $1 and created_at > now() - interval '1 day' and request->>'context' like 'A Discord message%'",
    [spender.id],
  );
  if (Number(r?.n ?? 0) >= PER_USER_PER_DAY) return { content: "That's a lot of checks today. Please try again tomorrow, or ask your spotter." };
  const found = await ctx.extract(text.slice(0, 50_000));
  if (!found.ok) throw new Error(`extraction failed: ${found.error}`);
  if (!found.found) {
    const scan = await scanMessage(ctx.deps.check, text);
    return { content: cut(scan.text.map((l, i) => (i === 0 ? `**${l}**` : l)).join("\n\n")) };
  }
  const p = await submitPayment(ctx.deps, {
    spenderId: spender.id,
    money: { amount: found.amountPence, currency: found.currency },
    payee: { name: found.payee, isNew: true },
    category: found.category,
    method: found.method,
    item: found.item,
    context: `A Discord message ${spender.name} asked Spotter to check:\n\n${text}`,
  });
  const final = (await getPayment(db, p.id)) ?? p;
  const [head, ...rest] = outcomeText(final, spender, ctx.site);
  return { content: cut([`**${head}**`, ...rest].join("\n\n")) };
}

async function status(ctx: DcCtx, spender: Spender): Promise<DcReply> {
  const rows = await ctx.deps.db.query<{ status: string; amount: string; currency: string; request: { payee: { name: string } } }>(
    "select status, amount, currency, request from payments where spender_id = $1 order by created_at desc limit 5",
    [spender.id],
  );
  if (!rows.length) return { content: "Nothing checked yet. Right click a message that asks you for money and pick **Check with Spotter**." };
  const word: Record<string, string> = { captured: "paid", needs_approval: "on hold", voided: "denied", blocked: "stopped", protected: "stopped", failed: "failed" };
  return {
    content: rows
      .map((p) => `${formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" })} to ${cut(p.request.payee.name, 80)}: ${word[p.status] ?? p.status}`)
      .join("\n"),
  };
}

async function denyButton(ctx: DcCtx, userId: string, paymentId: string): Promise<DcReply> {
  const { db } = ctx.deps;
  const own = (
    await db.query<{ spotter_name: string }>(
      "select h.spotter_name from payments p join spenders s on s.id = p.spender_id join households h on h.id = s.household_id where p.id = $1 and h.discord_user_id = $2",
      [paymentId, userId],
    )
  )[0];
  if (!own) return { content: "Only the spotter can deny this payment." };
  const before = await getPayment(db, paymentId);
  if (before?.status !== "needs_approval") return { content: `Already ${before?.status === "voided" ? "denied" : before?.status === "captured" ? "approved" : "decided"}.` };
  const after = await deny(ctx.deps, paymentId, own.spotter_name);
  const spender = await getSpender(db, after.spender_id);
  return {
    content:
      after.status === "voided"
        ? `**Denied.** PayPal released the hold, nothing was paid${spender ? `, and ${spender.name} has been told` : ""}.`
        : "PayPal couldn't release the hold. Check the dashboard.",
  };
}

export async function runInteraction(ctx: DcCtx, i: Interaction): Promise<DcReply> {
  const { db } = ctx.deps;
  const userId = i.member?.user?.id ?? i.user?.id;
  if (!userId) return { content: "Couldn't tell who you are." };

  if (i.type === 3) {
    // "Was it you?": bound to this Discord account (the asked person's own) and to a signed single use token.
    const wiy = parseButton(i.data?.custom_id);
    if (wiy) return { content: (await answerWasItYou(ctx.deps, { token: wiy.token, answer: wiy.answer, as: { channel: "discord", id: userId } })).reply };
    const id = /^deny:(pay_[a-z0-9]+)$/.exec(i.data?.custom_id ?? "")?.[1];
    return id ? denyButton(ctx, userId, id) : { content: "That button has expired." };
  }

  const spender = (await db.query<Spender>("select * from spenders where discord_user_id = $1", [userId]))[0] ?? null;

  if (i.data?.type === 3) {
    const msg = i.data.resolved?.messages?.[i.data.target_id ?? ""];
    if (!spender) return { content: NOT_CONNECTED };
    const text = msg ? readMessage(msg) : "";
    if (!text.trim()) return { content: "There's no text in that message to check. Nothing was paid." };
    return checkMessage(ctx, spender, text);
  }

  if (i.data?.type === 1 && i.data.name === "spotter") {
    const sub = i.data.options?.[0];
    if (sub?.name === "connect") {
      const code = findCode(String(sub.options?.find((o) => o.name === "code")?.value ?? ""));
      const paired = code ? await redeemPairingCode(db, code, "discord", userId) : null;
      if (!paired) return { content: "That code didn't work. It may be used or more than a day old. Ask your spotter for a new one." };
      return {
        content: paired.spender
          ? `**${paired.spender.name} is connected to Spotter.** When a message asks you for money, right click it (or long press on your phone), pick **Apps**, then **Check with Spotter**.`
          : "**You're connected.** When someone's payment needs you, Spotter sends you a DM with a button to deny it.",
      };
    }
    if (sub?.name === "status") return spender ? status(ctx, spender) : { content: NOT_CONNECTED };
  }
  return { content: "Unknown command." };
}
