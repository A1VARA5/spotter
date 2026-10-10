// Discord out: the spotter's alert DM (Deny button, and a link to approve on the dashboard with the PIN),
// and the answer back to the person who wanted to pay.
import type { Db } from "@/db";
import type { Payment, Spender } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";

type Dm = (userId: string, content: string, components?: unknown[]) => Promise<void>;
const amountOf = (p: Payment) => formatMoney({ amount: Number(p.amount), currency: p.currency as "GBP" });

export function alertContent(p: Payment, spender: Spender): string {
  const held = p.status === "needs_approval";
  const c = p.case_file;
  return [
    `**${held ? `${spender.name} wants to pay ${amountOf(p)}. It's on hold.` : `Spotter stopped ${amountOf(p)} from ${spender.name}.`}**`,
    `To ${p.request.payee.name}.${held ? " PayPal is holding the money until you decide." : ""}`,
    c?.headline ?? p.decision?.reasons[0] ?? "",
    ...(c?.findings.slice(0, 3).map((f) => `- ${f.text}`) ?? []),
    c?.ask[0] ? `*${c.ask[0]}*` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1900);
}

export function makeDiscordNotify(db: Db, site: string, dm: Dm) {
  return async (p: Payment, spender: Spender) => {
    const [hh] = await db.query<{ discord_user_id: string | null }>("select discord_user_id from households where id = $1", [spender.household_id]);
    if (!hh?.discord_user_id) return;
    const held = p.status === "needs_approval";
    const buttons = held
      ? [{ type: 2, style: 4, label: "Deny", custom_id: `deny:${p.id}` }, { type: 2, style: 5, label: "Review and approve", url: `${site}/dashboard` }]
      : [{ type: 2, style: 5, label: "See what happened", url: `${site}/dashboard` }];
    await dm(hh.discord_user_id, alertContent(p, spender), [{ type: 1, components: buttons }]);
  };
}

/** PayPal's own word (from its webhook) that a held payment was paid or released. */
export function makeDiscordConfirmed(db: Db, dm: Dm) {
  return async (p: Payment, spender: Spender) => {
    const [hh] = await db.query<{ discord_user_id: string | null }>("select discord_user_id from households where id = $1", [spender.household_id]);
    if (!hh?.discord_user_id) return;
    await dm(
      hh.discord_user_id,
      p.status === "captured"
        ? `PayPal confirmed: ${amountOf(p)} paid to ${p.request.payee.name}.`
        : `PayPal confirmed: ${amountOf(p)} released back to ${spender.name}.`,
    );
  };
}

export function makeDiscordDecided(dm: Dm) {
  return async (p: Payment, spender: Spender) => {
    if (!spender.discord_user_id) return;
    await dm(
      spender.discord_user_id,
      p.status === "captured"
        ? `**${spender.spotter_name} said yes.** ${amountOf(p)} to ${p.request.payee.name} has been paid.`
        : `**${spender.spotter_name} said no.** ${amountOf(p)} to ${p.request.payee.name} was not paid, and PayPal released the hold.`,
    );
  };
}
