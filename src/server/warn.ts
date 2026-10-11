// Sends a "someone switched Spotter off" warning (core/switchedoff.ts) to a household's spotter on every channel they
// connected: Telegram, Discord and email. Every channel gets its try; if any failed, one error names them all.
import type { Db } from "@/db";
import type { Warn, WarningKind } from "@/core/switchedoff";
import { esc } from "@/telegram/inbound";
import { layout } from "@/email/template"; // escapes headline and sub itself

type TgSend = (chatId: string, html: string, extra?: Record<string, unknown>) => Promise<void>;
type Dm = (userId: string, content: string, components?: unknown[]) => Promise<void>;
type Mail = (to: string, subject: string, text: string, html: string, key: string) => Promise<void>;


const SWITCHED_OFF = { heading: "A protection was just switched off", eyebrow: "Switched off" };
// Agent alerts (src/core/tripwire.ts, selling.ts, subscriptions.ts) travel the same channels with their own words.
const HEADINGS: Partial<Record<WarningKind, { heading: string; eyebrow: string }>> = {
  agent_hijacked: { heading: "An AI agent was paused", eyebrow: "Agent paused" },
  refund_held: { heading: "A refund is waiting for you", eyebrow: "Refund held" },
  subscription_held: { heading: "A subscription is waiting for you", eyebrow: "Subscription held" },
  hold_unconfirmed: { heading: "PayPal never answered about a payment", eyebrow: "Not paid" },
};

export function makeWarn(db: Db, site: string, ch: { telegram?: TgSend; discord?: Dm; email?: Mail }): Warn {
  return async (householdId, w) => {
    const [hh] = await db.query<{ telegram_chat_id: string | null; discord_user_id: string | null; alert_email: string | null }>(
      "select telegram_chat_id, discord_user_id, alert_email from households where id = $1",
      [householdId],
    );
    if (!hh) throw new Error(`household ${householdId} not found`);
    const link = `${site}/dashboard`;
    const { heading: HEADING, eyebrow } = HEADINGS[w.kind] ?? SWITCHED_OFF;
    const tasks: Array<Promise<void>> = [];
    // Each failure names its channel, so "403" in the log says which one.
    const tagged = (name: string, p: Promise<void>) =>
      p.catch((e) => {
        throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      });
    if (ch.telegram && hh.telegram_chat_id) {
      tasks.push(tagged("telegram", ch.telegram(hh.telegram_chat_id, `<b>${esc(HEADING)}</b>\n\n${esc(w.text)}`, { reply_markup: { inline_keyboard: [[{ text: "Open Spotter", url: link }]] } })));
    }
    if (ch.discord && hh.discord_user_id) {
      tasks.push(tagged("discord", ch.discord(hh.discord_user_id, `**${HEADING}**\n${w.text}`, [{ type: 1, components: [{ type: 2, style: 5, label: "Open Spotter", url: link }] }])));
    }
    if (ch.email && hh.alert_email) {
      const html = layout({ site, preheader: w.text, tone: "stopped", eyebrow, headline: HEADING, sub: w.text, body: "", cta: { label: "Open Spotter", href: link } });
      tasks.push(tagged("email", ch.email(hh.alert_email, HEADING, `${HEADING}\n\n${w.text}\n\n${link}`, html, `warn-${householdId}-${w.kind}-${Date.now()}`)));
    }
    const failed = (await Promise.allSettled(tasks)).filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) throw new Error(failed.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; "));
  };
}
