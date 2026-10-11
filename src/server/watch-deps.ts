// Real dependencies for price watches: Postgres, Channel3's price tracking and product endpoints, and the
// spotter's alert channels (Telegram, Discord, email) for a drop.
import { getDb } from "@/db";
import type { WatchDeps } from "@/core/watch";
import { priceHistory, productOffers, searchProducts, startTracking, stopTracking } from "@/market/channel3";
import { sendHtml } from "@/telegram/api";
import { sendDm } from "@/discord/api";
import { send } from "@/email/agentboxd";
import { makeDropNotify } from "./watch-notify";

export async function getWatchDeps(): Promise<WatchDeps> {
  const db = await getDb();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://spotter-pay.vercel.app";
  return {
    db,
    c3: { search: searchProducts, start: startTracking, stop: stopTracking, history: (id) => priceHistory(id), product: productOffers },
    notify: makeDropNotify(db, site, {
      ...(process.env.TELEGRAM_BOT_TOKEN ? { telegram: sendHtml } : {}),
      ...(process.env.DISCORD_BOT_TOKEN ? { discord: (id: string, text: string) => sendDm(id, text) } : {}),
      ...(process.env.AGENTBOXD_API_KEY ? { email: send } : {}),
    }),
  };
}
