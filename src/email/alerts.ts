// Email out: tells the spotter when a payment needs them or was stopped. Approving still needs the PIN on the
// dashboard; the email only links there, so a forwarded or leaked alert can't move money.
import type { Db } from "@/db";
import type { Payment, Spender } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";
import { send } from "./agentboxd";
import { askingAgain } from "@/core/sleep";
import { block, esc, layout, list, markedText, quoteBox, track } from "./template";
import { askLines, tokenFor, wasItYouLine, type WasItYou } from "@/core/was-it-you";

export function alertEmail(p: Payment, spender: Spender, site: string): { subject: string; text: string; html: string } {
  const amount = formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" });
  const to = p.request.payee.name;
  const held = p.status === "needs_approval";
  const reasons = p.decision?.reasons ?? [];
  const link = `${site}/dashboard`;
  const again = askingAgain(p);
  const subject = held
    ? `${again ? "Asking again: " : ""}${spender.name} wants to pay ${amount}. It's ${again ? "still " : ""}on hold`
    : `Spotter stopped ${amount} from ${spender.name}`;
  const headline = held ? `${again ? "Asking again: " : ""}${spender.name} wants to pay ${amount}` : `Spotter stopped ${amount} from ${spender.name}`;
  const sub = held
    ? `To ${to}. PayPal is holding the money until you decide. Nothing has left yet.`
    : p.status === "protected"
      ? `To ${to}. It was asked for in a way that has no buyer protection, so Spotter didn't send it.`
      : `To ${to}. It broke one of ${spender.name}'s rules, so Spotter didn't send it.`;

  const flags = (p.ai?.flags ?? []).filter((f) => f.quote);
  const w = p.was_it_you;
  const merged = held && w?.channel === "alert" && w.state === "asked";
  const wiyText = merged ? askLines(p, spender, w).join(" ") : wasItYouLine(w);
  const wiyHtml = merged
    ? `${para(askLines(p, spender, w).join(" "))}<p style="margin:0"><a href="${esc(answerLink(site, w, p.id))}" style="font:600 15px -apple-system,Segoe UI,Arial,sans-serif;color:#17212b">Answer: not me, or yes it's me</a></p>`
    : wiyText
      ? para(wiyText)
      : "";
  const body = [
    track(spender.name, amount, to, held ? "held" : "stopped"),
    wiyHtml ? block("Was it you?", wiyHtml) : "",
    reasons.length ? block(held ? "Why it's waiting for you" : "Why it was stopped", list(reasons)) : "",
    p.ai?.summary ? block("What the scam check saw", `<p style="margin:0 0 10px;font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#17212b">${esc(p.ai.summary)}</p>`) : "",
    p.request.context ? block("The message, with the warning words marked", quoteBox(markedText(p.request.context, flags.map((f) => ({ quote: f.quote, high: f.severity === "high" }))))) : "",
  ].join("");

  const html = layout({
    site,
    preheader: `${headline}. ${reasons[0] ?? ""}`,
    tone: held ? "held" : "stopped",
    eyebrow: held ? "Waiting for you" : "Stopped",
    headline,
    sub,
    body,
    cta: held ? { label: "Review and decide", href: link, note: "Approving needs your Spotter PIN." } : { label: "See what happened", href: link },
  });
  const text = [
    headline,
    sub,
    wiyText ? `${wiyText}${merged ? ` Answer: ${answerLink(site, w, p.id)}` : ""}` : "",
    ...reasons.map((r) => `- ${r}`),
    p.ai?.summary ?? "",
    `${held ? "Review and decide" : "See what happened"}: ${link}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, text, html };
}

const para = (s: string) => `<p style="margin:0 0 10px;font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#17212b">${esc(s)}</p>`;

/** The answer page. Opening it changes nothing (mail scanners open links); the buttons on it do. */
const answerLink = (site: string, w: WasItYou, paymentId: string) => `${site}/was-it-you?t=${encodeURIComponent(tokenFor(w, paymentId))}`;

/** The question to the real person a message claims to be from, when email is what they linked. */
export function askEmail(p: Payment, payer: Spender, w: WasItYou, site: string): { subject: string; text: string; html: string } {
  const [q, quote] = askLines(p, payer, w);
  const link = answerLink(site, w, p.id);
  const why = `PayPal is holding ${payer.name}'s money while we check. If it wasn't you, Not me releases it straight away. Yes, it's me doesn't pay anything: ${payer.spotter_name} still decides.`;
  const html = layout({
    site,
    preheader: q,
    tone: "held",
    eyebrow: "Was it you?",
    headline: q,
    sub: quote,
    body: block("Why you", para(why)),
    cta: { label: "Answer: not me, or yes it's me", href: link, note: "The link works once, for an hour." },
  });
  return { subject: `Did you message ${payer.name} asking for money?`, text: [q, quote, why, `Answer here: ${link}`].join("\n\n"), html };
}

export function makeEmailAsk(site: string) {
  return async (p: Payment, payer: Spender, w: WasItYou, to: Spender) => {
    if (!to.email) throw new Error("they have no email linked");
    const e = askEmail(p, payer, w, site);
    await send(to.email, e.subject, e.text, e.html, `wiy-${w.id}`);
  };
}

/** A plain note to the spotter's alert email (e.g. "Tom says they didn't send it"). */
export function makeEmailNote(db: Db, site: string) {
  return async (p: Payment, spender: Spender, text: string): Promise<boolean> => {
    const [hh] = await db.query<{ alert_email: string | null }>("select alert_email from households where id = $1", [spender.household_id]);
    if (!hh?.alert_email) return false;
    const html = layout({ site, preheader: text, tone: "info", eyebrow: "Was it you?", headline: text, body: "", cta: { label: "Open Spotter", href: `${site}/dashboard` } });
    await send(hh.alert_email, text.slice(0, 120), text, html, `note-${p.id}-${Date.now()}`);
    return true;
  };
}

export function makeNotify(db: Db, site: string) {
  return async (p: Payment, spender: Spender) => {
    const [hh] = await db.query<{ alert_email: string | null }>("select alert_email from households where id = $1", [spender.household_id]);
    if (!hh?.alert_email) return;
    const e = alertEmail(p, spender, site);
    // A morning "ask again" is a new email, not a repeat of the first alert the idempotency key would swallow.
    await send(hh.alert_email, e.subject, e.text, e.html, askingAgain(p) ? `alert-${p.id}-again-${p.sleeps}` : `alert-${p.id}`);
  };
}
