// Email in. Someone paired with Spotter forwards an email that asks for money to spotter@homingbox.net.
// Spotter checks the sender really sent it, reads the payment out of it, runs the full check (rules, AI,
// PayPal hold), and replies in the same thread. Unknown or forged senders get nothing back: no backscatter,
// and nobody can make Spotter email a stranger.
import type { Db } from "@/db";
import { getPayment, submitPayment, type Deps, type Payment, type Spender } from "@/core/lifecycle";
import { findCode, redeemPairingCode } from "@/core/pairing";
import { formatMoney } from "@/core/types";
import type { Extracted } from "@/ai/extract";
import { htmlToText, senderOf, senderVerified, type MailEvent, type MailMessage } from "./agentboxd";

export type InboundCtx = {
  deps: Deps;
  site: string;
  getMessage: (id: string) => Promise<MailMessage | null>;
  reply: (inboxId: string, messageId: string, text: string, html: string) => Promise<void>;
  extract: (text: string) => Promise<Extracted>;
};

export type InboundOutcome = "ignored" | "duplicate" | "unverified" | "unpaired" | "paired" | "limited" | "no_payment" | "failed" | "checked";

const PER_SENDER_PER_DAY = 6;
const ALL_PER_DAY = 60;
const EVENTS = new Set(["message.received", "message.enriched", "message.released"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = (paras: string[]) => paras.map((p) => `<p style="font:16px/1.5 system-ui,sans-serif;color:#17212b">${esc(p)}</p>`).join("");

async function record(db: Db, messageId: string): Promise<boolean> {
  const rows = await db.query("insert into inbound (provider, message_id) values ('agentboxd', $1) on conflict do nothing returning message_id", [messageId]);
  return rows.length > 0;
}

async function overLimit(db: Db, sender: string): Promise<boolean> {
  const [r] = await db.query<{ mine: string; all: string }>(
    `select count(*) filter (where sender = $1)::text as mine, count(*)::text as all
     from inbound where received_at > now() - interval '1 day' and sender is not null`,
    [sender],
  );
  return Number(r?.mine ?? 0) >= PER_SENDER_PER_DAY || Number(r?.all ?? 0) >= ALL_PER_DAY;
}

/** The outcome in plain words, for the person who forwarded it. */
export function outcomeText(p: Payment, spender: Spender, site: string): string[] {
  const amount = formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" });
  const to = p.request.payee.name;
  const why = p.decision?.reasons.length ? `Why: ${p.decision.reasons.join(" ")}` : "";
  const head: Record<string, string> = {
    captured: `Paid ${amount} to ${to}. Nothing looked wrong.`,
    needs_approval: `Not paid yet. ${amount} to ${to} is on hold until ${spender.spotter_name} says yes. The money is reserved, nothing has left.`,
    blocked: `Not paid. Spotter stopped ${amount} to ${to}.`,
    protected: `Not paid. ${amount} to ${to} was asked for in a way that has no protection if it goes wrong, so Spotter didn't send it.`,
    failed: `Not paid. PayPal couldn't complete it, so nothing was paid.`,
  };
  return [
    head[p.status] ?? `Not paid yet. ${amount} to ${to} is still being checked.`,
    why,
    p.status === "protected" ? `If this really is someone you know, call them on the number you already have before sending anything.` : "",
    `${spender.spotter_name} can see the full details: ${site}/dashboard`,
  ].filter(Boolean);
}

export async function handleInboundEmail(ctx: InboundCtx, evt: MailEvent): Promise<InboundOutcome> {
  const { db } = ctx.deps;
  const thin = evt.data?.message;
  const inboxId = evt.data?.inbox?.id;
  if (!EVENTS.has(evt.type) || !thin?.id || !inboxId) return "ignored";
  if (!(await record(db, thin.id))) return "duplicate";

  const m = thin.text || thin.html ? thin : ((await ctx.getMessage(thin.id)) ?? thin);
  const from = senderOf(m);
  const inbox = (evt.data?.inbox?.address ?? "").toLowerCase();
  // Never answer ourselves, bounces or auto replies, or our own threads: that is how mail loops start.
  if (!from || from === inbox || /mailer-daemon|postmaster|no-?reply/i.test(from) || /^(re:\s*)*spotter:/i.test(m.subject ?? "")) return "ignored";
  if (!senderVerified(m)) {
    console.warn("[spotter] email sender failed SPF/DKIM, ignoring", JSON.stringify(m.id));
    return "unverified";
  }
  if (await overLimit(db, from)) return "limited";
  await db.query("update inbound set sender = $2 where provider = 'agentboxd' and message_id = $1", [thin.id, from]);

  const body = (m.text?.trim() || (m.html ? htmlToText(m.html) : "") || m.extracted_text || "").slice(0, 100_000);
  const text = m.subject ? `Subject: ${m.subject}\n\n${body}` : body;
  const say = (paras: string[]) => ctx.reply(inboxId, m.id, paras.join("\n\n"), html(paras));

  const code = findCode(text);
  if (code) {
    const paired = await redeemPairingCode(db, code, "email", from);
    if (!paired) return "unpaired"; // a wrong or used code gets no reply, so codes can't be guessed by mail
    await say(
      paired.spender
        ? [`${paired.spender.name} is connected to Spotter.`, `From now on, forward any email that asks for money to this address. Spotter checks it and replies here.`]
        : [`You're connected. Spotter will email you here when someone's payment needs you.`],
    );
    return "paired";
  }

  const spender = (await db.query<Spender>("select * from spenders where lower(email) = $1", [from]))[0];
  if (!spender) return "unpaired";

  const found = await ctx.extract(text);
  if (!found.ok) {
    console.error("[spotter] email extraction failed:", found.error);
    await say([`Spotter couldn't check this email right now. Nothing was paid.`, `Try forwarding it again in a few minutes, or ask ${spender.spotter_name}.`]);
    return "failed";
  }
  if (!found.found) {
    await say([`Spotter couldn't find a request for money in this email, so nothing was paid.`, `If someone is asking you to pay, forward the message that has the amount in it.`]);
    return "no_payment";
  }

  const p = await submitPayment(ctx.deps, {
    spenderId: spender.id,
    money: { amount: found.amountPence, currency: found.currency },
    payee: { name: found.payee, isNew: true },
    category: found.category,
    method: found.method,
    item: found.item,
    context: `An email ${spender.name} forwarded to Spotter:\n\n${text}`,
  });
  await say(outcomeText((await getPayment(db, p.id)) ?? p, spender, ctx.site));
  return "checked";
}
