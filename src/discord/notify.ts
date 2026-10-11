// Discord out: the spotter's alert DM (Deny button, and a link to approve on the dashboard with the PIN),
// and the answer back to the person who wanted to pay.
import type { Db } from "@/db";
import type { Payment, Spender } from "@/core/lifecycle";
import { formatMoney } from "@/core/types";
import { askLines, buttonId, notMeText, tokenFor, wasItYouLine, type WasItYou } from "@/core/was-it-you";

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
    wiyLine(p, spender, held),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1900);
}

/** The question merged into the spotter's alert (the message claims to be them), or one line on who was asked. */
function wiyLine(p: Payment, spender: Spender, held: boolean): string {
  const w = p.was_it_you;
  if (held && w?.channel === "alert" && w.state === "asked") {
    const [q, quote] = askLines(p, spender, w);
    return `**${q}** ${quote}`;
  }
  return wasItYouLine(w) ?? "";
}

/** "Not me" and "Yes, it's me". Yes only writes the answer down; it never pays. */
const answerButtons = (w: WasItYou, paymentId: string) => {
  const token = tokenFor(w, paymentId);
  return [
    { type: 2, style: 4, label: "Not me", custom_id: buttonId("not_me", token) },
    { type: 2, style: 2, label: "Yes, it's me", custom_id: buttonId("it_was_me", token) },
  ];
};

export function makeDiscordAsk(dm: Dm) {
  return async (p: Payment, payer: Spender, w: WasItYou, to: Spender) => {
    if (!to.discord_user_id) throw new Error("they have no Discord account linked");
    const [q, quote] = askLines(p, payer, w);
    const content = [
      `**${q}**`,
      quote,
      `PayPal is holding ${payer.name}'s money while we check. If it wasn't you, press Not me and it's released straight away. Yes, it's me doesn't pay anything: ${payer.spotter_name} still decides.`,
    ].join("\n\n");
    await dm(to.discord_user_id, content.slice(0, 1900), [{ type: 1, components: answerButtons(w, p.id) }]);
  };
}

/** A plain note to the spotter's DMs (e.g. "Tom says they didn't send it"). */
export function makeDiscordNote(db: Db, dm: Dm) {
  return async (p: Payment, spender: Spender, text: string): Promise<boolean> => {
    const [hh] = await db.query<{ discord_user_id: string | null }>("select discord_user_id from households where id = $1", [spender.household_id]);
    if (!hh?.discord_user_id) return false;
    await dm(hh.discord_user_id, text.slice(0, 1900));
    return true;
  };
}

export function makeDiscordNotify(db: Db, site: string, dm: Dm) {
  return async (p: Payment, spender: Spender) => {
    const [hh] = await db.query<{ discord_user_id: string | null }>("select discord_user_id from households where id = $1", [spender.household_id]);
    if (!hh?.discord_user_id) return;
    const held = p.status === "needs_approval";
    const buttons = held
      ? [{ type: 2, style: 4, label: "Deny", custom_id: `deny:${p.id}` }, { type: 2, style: 5, label: "Review and approve", url: `${site}/dashboard` }]
      : [{ type: 2, style: 5, label: "See what happened", url: `${site}/dashboard` }];
    const w = p.was_it_you;
    const merged = held && w?.channel === "alert" && w.state === "asked" ? [{ type: 1, components: answerButtons(w, p.id) }] : [];
    await dm(hh.discord_user_id, alertContent(p, spender), [...merged, { type: 1, components: buttons }]);
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
    const w = p.was_it_you;
    await dm(
      spender.discord_user_id,
      w?.state === "not_me" && p.status === "voided"
        ? `**${notMeText(w, p)}**`
        : p.status === "captured"
        ? `**${spender.spotter_name} said yes.** ${amountOf(p)} to ${p.request.payee.name} has been paid.`
        : `**${spender.spotter_name} said no.** ${amountOf(p)} to ${p.request.payee.name} was not paid, and PayPal released the hold.`,
    );
  };
}
