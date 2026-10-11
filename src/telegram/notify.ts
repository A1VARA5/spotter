// Telegram out: the spotter's alert (with a one tap Deny; approving opens the dashboard and needs the PIN),
// and the answer back to the person who wanted to pay.
import type { Db } from "@/db";
import type { Payment, Spender } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";
import { esc } from "./inbound";
import { askingAgain } from "@/core/sleep";

type Send = (chatId: string, html: string, extra?: Record<string, unknown>) => Promise<void>;

const amountOf = (p: Payment) => formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" });

export function alertText(p: Payment, spender: Spender): string {
  const held = p.status === "needs_approval";
  const head = held
    ? askingAgain(p)
      ? `Asking again, as you wanted: ${spender.name} wants to pay ${amountOf(p)}. It's still on hold.`
      : `${spender.name} wants to pay ${amountOf(p)}. It's on hold.`
    : `Spotter stopped ${amountOf(p)} from ${spender.name}.`;
  const c = p.case_file;
  const lines = [
    `<b>${esc(head)}</b>`,
    `To ${esc(p.request.payee.name)}.${held ? " PayPal is holding the money until you decide." : ""}`,
    c ? esc(c.headline) : p.decision?.reasons[0] ? esc(p.decision.reasons[0]) : "",
    ...(c?.findings.slice(0, 3).map((f) => `• ${esc(f.text)}`) ?? []),
    c?.ask[0] ? `<i>${esc(c.ask[0])}</i>` : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

export function makeTelegramNotify(db: Db, site: string, send: Send) {
  return async (p: Payment, spender: Spender) => {
    const [hh] = await db.query<{ telegram_chat_id: string | null }>("select telegram_chat_id from households where id = $1", [spender.household_id]);
    if (!hh?.telegram_chat_id) return;
    const held = p.status === "needs_approval";
    const buttons = held
      ? [[{ text: "Deny", callback_data: `deny:${p.id}` }, { text: "Review and approve", url: `${site}/dashboard` }]]
      : [[{ text: "See what happened", url: `${site}/dashboard` }]];
    await send(hh.telegram_chat_id, alertText(p, spender), { reply_markup: { inline_keyboard: buttons }, link_preview_options: { is_disabled: true } });
  };
}

/** PayPal's own word (from its webhook) that a held payment was paid or released. */
export function confirmedText(p: Payment, spender: Pick<Spender, "name">): string {
  return p.status === "captured"
    ? `PayPal confirmed: ${esc(amountOf(p))} paid to ${esc(p.request.payee.name)}.`
    : `PayPal confirmed: ${esc(amountOf(p))} released back to ${esc(spender.name)}.`;
}

export function makeTelegramConfirmed(db: Db, send: Send) {
  return async (p: Payment, spender: Spender) => {
    const [hh] = await db.query<{ telegram_chat_id: string | null }>("select telegram_chat_id from households where id = $1", [spender.household_id]);
    if (!hh?.telegram_chat_id) return;
    await send(hh.telegram_chat_id, confirmedText(p, spender));
  };
}

export function makeTelegramDecided(send: Send) {
  return async (p: Payment, spender: Spender) => {
    if (!spender.telegram_chat_id) return;
    const to = esc(p.request.payee.name);
    const who = esc(spender.spotter_name);
    const text =
      p.status === "captured"
        ? `<b>${who} said yes.</b> ${esc(amountOf(p))} to ${to} has been paid.`
        : `<b>${who} said no.</b> ${esc(amountOf(p))} to ${to} was not paid, and PayPal released the hold.\n\nIf this was someone you know, call them on the number you already have for them.`;
    await send(spender.telegram_chat_id, text);
  };
}
