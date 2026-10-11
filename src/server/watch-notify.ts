// Tells the spotter (never the person who wanted it) that a watched price came down at a real shop. The notice only
// informs: no button buys anything, and the link goes to the shop's own page. The spotter decides what happens next.
import type { Db } from "@/db";
import type { WatchView } from "@/core/watch";
import { formatMoney } from "@/core/types";
import { esc as tgEsc } from "@/telegram/inbound";
import { esc, layout } from "@/email/template";

type Senders = {
  telegram?: (chatId: string, html: string, extra?: Record<string, unknown>) => Promise<void>;
  discord?: (userId: string, content: string) => Promise<void>;
  email?: (to: string, subject: string, text: string, html: string, key: string) => Promise<void>;
};

const m = (w: WatchView, minor: number) => formatMoney({ amount: minor, currency: w.currency });

/** Backslashes Discord's markdown characters, so outside text can't become a masked link, a heading or bold. */
export const discordEsc = (s: string) => s.replace(/[\\*_~`|>#\-[\]()]/g, "\\$&");

/**
 * The notice in plain sentences. It names the product by Channel3's title (live shop data) rather than the item text
 * the agent or payment gave. Title and shop still come from outside, so each channel escapes them.
 */
export function dropLines(w: WatchView): string[] {
  const who = w.who ?? "Someone";
  const name = w.title.trim() || w.item;
  return [
    w.best ? `Price watch: ${w.best.shop} now sells the ${name} ${who} wanted for ${m(w, w.best.price)}.` : `Price watch: the ${name} ${who} wanted costs less at a real shop now.`,
    w.saving ? `That's ${m(w, w.saving)} less than ${who} nearly paid (${m(w, w.nearlyPaid)}).` : "",
    "Nothing is bought unless you decide to.",
  ].filter(Boolean);
}

export function makeDropNotify(db: Db, site: string, send: Senders) {
  return async (w: WatchView & { householdId: string }) => {
    const [hh] = await db.query<{ telegram_chat_id: string | null; discord_user_id: string | null; alert_email: string | null }>(
      "select telegram_chat_id, discord_user_id, alert_email from households where id = $1",
      [w.householdId],
    );
    if (!hh) throw new Error(`no household ${w.householdId} for price drop ${w.id}`);
    const lines = dropLines(w);
    const link = w.best?.url && /^https:\/\//.test(w.best.url) ? w.best.url : "";
    const jobs: Array<Promise<void>> = [];
    if (hh.telegram_chat_id && send.telegram) {
      const html = [`<b>${tgEsc(lines[0]!)}</b>`, ...lines.slice(1).map(tgEsc)].join("\n\n");
      const buttons = [[...(link ? [{ text: "See it at the shop", url: link }] : []), { text: "Open Spotter", url: `${site}/dashboard` }]];
      jobs.push(send.telegram(hh.telegram_chat_id, html, { reply_markup: { inline_keyboard: buttons }, link_preview_options: { is_disabled: true } }));
    }
    if (hh.discord_user_id && send.discord) {
      jobs.push(send.discord(hh.discord_user_id, [`**${discordEsc(lines[0]!)}**`, ...lines.slice(1).map(discordEsc), link ? `See it at the shop: <${link}>` : ""].filter(Boolean).join("\n").slice(0, 1900)));
    }
    if (hh.alert_email && send.email) {
      const html = layout({
        site,
        preheader: lines[0]!,
        tone: "info",
        eyebrow: "Price watch",
        headline: lines[0]!,
        sub: lines.slice(1).join(" "),
        body: link ? `<tr><td style="padding:8px 28px"><p style="margin:0;font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif"><a href="${esc(link)}">See it at the shop</a></p></td></tr>` : "",
        cta: { label: "Open Spotter", href: `${site}/dashboard` },
      });
      jobs.push(send.email(hh.alert_email, lines[0]!, [...lines, link, `${site}/dashboard`].filter(Boolean).join("\n\n"), html, `watch-${w.id}`));
    }
    // Not an error: the drop still shows on the dashboard and in Watchtower. Worth a line in the logs though.
    if (!jobs.length) console.warn(`[spotter] price drop ${w.id}: the spotter has no alert channel set up, so it shows on the dashboard only`);
    const failed = (await Promise.allSettled(jobs)).filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) throw new Error(failed.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; "));
  };
}
