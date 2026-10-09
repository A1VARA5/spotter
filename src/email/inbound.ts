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
  sendTo: (to: string, subject: string, text: string, html: string, key: string) => Promise<void>;
  extract: (text: string) => Promise<Extracted>;
};

export type InboundOutcome = "ignored" | "duplicate" | "unverified" | "unpaired" | "paired" | "limited" | "no_payment" | "failed" | "checked";

const PER_SENDER_PER_DAY = 6;
const ALL_PER_DAY = 60;
const EVENTS = new Set(["message.received", "message.enriched", "message.released"]);

import { simple, type Tone } from "./template";

const EYEBROW: Record<Tone, string> = { held: "On hold", stopped: "Not paid", paid: "Paid", info: "Spotter" };

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

/** The person's own words: the subject, and the body only when it is short and not a forward. */
function ownWords(subject: string, body: string): string {
  const forwarded = /forwarded message|original message|^\s*from:/im.test(body);
  return body.length < 300 && !forwarded ? `${subject}\n${body}` : subject;
}

function replyToOf(m: MailMessage): string | null {
  const h = Object.entries(m.headers ?? {}).find(([k]) => k.toLowerCase() === "reply-to")?.[1];
  const v = Array.isArray(h) ? h[0] : h;
  return v ? senderOf({ from: v }) : null;
}

export async function handleInboundEmail(ctx: InboundCtx, evt: MailEvent): Promise<InboundOutcome> {
  const { db } = ctx.deps;
  const thin = evt.data?.message;
  const inboxId = evt.data?.inbox?.id;
  if (!EVENTS.has(evt.type) || !thin?.id || !inboxId) return "ignored";
  if (!(await record(db, thin.id))) return "duplicate";

  let paymentId: string | null = null;
  let say: ((paras: string[], tone?: Tone) => Promise<void>) | null = null;
  const finish = async (outcome: InboundOutcome) => {
    await db.query("update inbound set outcome = $2 where provider = 'agentboxd' and message_id = $1", [thin.id, outcome]);
    return outcome;
  };

  try {
    const m = thin.text || thin.html || thin.headers ? thin : await ctx.getMessage(thin.id);
    if (!m) throw new Error("Couldn't fetch the email from Agentboxd.");
    const from = senderOf(m);
    const inbox = (evt.data?.inbox?.address ?? "").toLowerCase();
    // Never answer ourselves, bounces or auto replies, or our own threads: that is how mail loops start.
    if (!from || from === inbox || /mailer-daemon|postmaster|no-?reply/i.test(from) || /^(re:\s*)*spotter:/i.test(m.subject ?? "")) return finish("ignored");
    if (!senderVerified(m)) {
      console.warn("[spotter] email sender failed SPF/DKIM, ignoring", JSON.stringify(m.id));
      return finish("unverified");
    }
    if (await overLimit(db, from)) {
      console.warn("[spotter] email daily limit reached for a sender", JSON.stringify(m.id));
      return finish("limited");
    }
    await db.query("update inbound set sender = $2 where provider = 'agentboxd' and message_id = $1", [thin.id, from]);

    const subject = m.subject ?? "";
    const page = (paras: string[], tone: Tone) => simple(ctx.site, tone, EYEBROW[tone], paras[0] ?? "Spotter", paras.slice(1));
    const body = (m.text?.trim() || (m.html ? htmlToText(m.html) : "") || m.extracted_text || "").slice(0, 100_000);
    const text = subject ? `Subject: ${subject}\n\n${body}` : body;
    // Replies go only to the verified sender. If the email names a different Reply-To, send a fresh email
    // to the verified address instead of replying in the thread.
    const rt = replyToOf(m);
    say =
      rt && rt !== from
        ? (paras, tone = "info") => ctx.sendTo(from, `Re: ${subject}`.slice(0, 200), paras.join("\n\n"), page(paras, tone), `reply-${m.id}`)
        : (paras, tone = "info") => ctx.reply(inboxId, m.id, paras.join("\n\n"), page(paras, tone));

    const spender = (await db.query<Spender>("select * from spenders where lower(email) = $1", [from]))[0];

    // Pairing codes only count in the sender's own words, never inside a forwarded email: a scammer could plant one.
    const code = findCode(ownWords(subject, body));
    if (code) {
      const paired = await redeemPairingCode(db, code, "email", from);
      if (paired) {
        await say(
          paired.spender
            ? [`${paired.spender.name} is connected to Spotter.`, `From now on, forward any email that asks for money to this address. Spotter checks it and replies here.`]
            : [`You're connected. Spotter will email you here when someone's payment needs you.`],
        );
        return finish("paired");
      }
      // A wrong or used code gets no reply, so codes can't be guessed by mail. A paired sender carries on to the check.
      if (!spender) return finish("unpaired");
    }
    if (!spender) return finish("unpaired");

    const found = await ctx.extract(text);
    if (!found.ok) throw new Error(`extraction failed: ${found.error}`);
    if (!found.found) {
      await say([`Spotter couldn't find a request for money in this email, so nothing was paid.`, `If someone is asking you to pay, forward the message that has the amount in it.`]);
      return finish("no_payment");
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
    paymentId = p.id;
    const final = (await getPayment(db, p.id)) ?? p;
    const tone: Tone = final.status === "needs_approval" ? "held" : final.status === "captured" ? "paid" : "stopped";
    await say(outcomeText(final, spender, ctx.site), tone);
    return finish("checked");
  } catch (e) {
    console.error("[spotter] email handling failed:", e instanceof Error ? e.message : e);
    if (paymentId) {
      // The payment exists and is visible on the dashboard; only the reply failed. Don't retry the payment.
      await finish("failed").catch(() => {});
    } else {
      // Nothing was created: forget we saw it, so the next delivery of the same email can try again.
      await db.query("delete from inbound where provider = 'agentboxd' and message_id = $1", [thin.id]).catch(() => {});
      if (say) await say([`Spotter couldn't check this email right now. Nothing was paid.`, `Try forwarding it again in a few minutes.`]).catch(() => {});
    }
    return "failed";
  }
}
