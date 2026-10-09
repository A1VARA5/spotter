// Email out: tells the spotter when a payment needs them or was stopped. Approving still needs the PIN on the
// dashboard; the email only links there, so a forwarded or leaked alert can't move money.
import type { Db } from "@/db";
import type { Payment, Spender } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";
import { send } from "./agentboxd";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function alertEmail(p: Payment, spender: Spender, site: string): { subject: string; text: string; html: string } {
  const amount = formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" });
  const to = p.request.payee.name;
  const what =
    p.status === "needs_approval"
      ? `${spender.name} wants to pay ${amount} to ${to}. It's on hold until you decide.`
      : p.status === "protected"
        ? `Spotter didn't send ${amount} from ${spender.name} to ${to}: it was asked for in a way with no protection.`
        : `Spotter stopped ${amount} from ${spender.name} to ${to}.`;
  const subject = p.status === "needs_approval" ? `Spotter: ${spender.name} needs your yes for ${amount}` : `Spotter: stopped ${amount} from ${spender.name}`;
  const reasons = p.decision?.reasons ?? [];
  const link = `${site}/dashboard`;
  const text = [what, ...reasons.map((r) => `- ${r}`), `Open Spotter to see the evidence${p.status === "needs_approval" ? " and approve or deny" : ""}: ${link}`].join("\n\n");
  const html = [
    `<p style="font:600 18px/1.4 system-ui,sans-serif;color:#17212b">${esc(what)}</p>`,
    reasons.length ? `<ul style="font:16px/1.5 system-ui,sans-serif;color:#4a5866">${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "",
    `<p><a href="${esc(link)}" style="display:inline-block;background:#17212b;color:#f3f5f2;padding:12px 18px;border-radius:12px;font:600 16px system-ui,sans-serif;text-decoration:none">${p.status === "needs_approval" ? "Review and decide" : "See what happened"}</a></p>`,
  ].join("");
  return { subject, text, html };
}

export function makeNotify(db: Db, site: string) {
  return async (p: Payment, spender: Spender) => {
    const [hh] = await db.query<{ alert_email: string | null }>("select alert_email from households where id = $1", [spender.household_id]);
    if (!hh?.alert_email) return;
    const e = alertEmail(p, spender, site);
    await send(hh.alert_email, e.subject, e.text, e.html, `alert-${p.id}`);
  };
}
