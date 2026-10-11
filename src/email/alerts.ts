// Email out: tells the spotter when a payment needs them or was stopped. Approving still needs the PIN on the
// dashboard; the email only links there, so a forwarded or leaked alert can't move money.
import type { Db } from "@/db";
import type { Payment, Spender } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";
import { send } from "./agentboxd";
import { askingAgain } from "@/core/sleep";
import { block, esc, layout, list, markedText, quoteBox, track } from "./template";

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
  const body = [
    track(spender.name, amount, to, held ? "held" : "stopped"),
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
  const text = [headline, sub, ...reasons.map((r) => `- ${r}`), p.ai?.summary ?? "", `${held ? "Review and decide" : "See what happened"}: ${link}`].filter(Boolean).join("\n\n");
  return { subject, text, html };
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
