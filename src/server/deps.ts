// Real dependencies for the running app: Postgres, Claude, PayPal sandbox, Channel3.
import { getDb } from "@/db";
import { aiCheck } from "@/ai/check";
import { captureAuthorization, createAuthorizeOrder, getAuthorization, voidAuthorization } from "@/paypal/client";
import type { Deps } from "@/core/lifecycle";
import { makeMarket, priceHigh, searchByImage, searchProducts } from "@/market/channel3";
import { spotTheDifference } from "@/market/lookalike";
import { cap } from "@/watchtower/llm";
import { after } from "next/server";
import { buildCase } from "@/agents/case";
import { visitInCloud } from "@/agents/kernel";
import { sendHtml } from "@/telegram/api";
import { makeTelegramConfirmed, makeTelegramDecided, makeTelegramNotify } from "@/telegram/notify";
import { sendDm } from "@/discord/api";
import { makeDiscordConfirmed, makeDiscordDecided, makeDiscordNotify } from "@/discord/notify";
import type { Payment, Spender } from "@/core/lifecycle";
import { makeNotify } from "@/email/alerts";

let ready: Promise<Deps> | null = null;

type Alert = (p: Payment, s: Spender) => Promise<void>;

/** Every channel gets its try; if any failed, one error names them all so the caller logs it. */
function allOf(alerts: Array<Alert | null>): Alert | undefined {
  const live = alerts.filter((a): a is Alert => a !== null);
  if (!live.length) return undefined;
  return async (p, s) => {
    const results = await Promise.allSettled(live.map((a) => a(p, s)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) throw new Error(failed.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; "));
  };
}

export function getDeps(): Promise<Deps> {
  ready ??= (async () => {
    const db = await getDb();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://spotter-pay.vercel.app";
    return {
      db,
      check: (req) => aiCheck(req),
      market: makeMarket(db),
      notify: allOf([
        process.env.AGENTBOXD_API_KEY ? makeNotify(db, site) : null,
        process.env.TELEGRAM_BOT_TOKEN ? makeTelegramNotify(db, site, sendHtml) : null,
        process.env.DISCORD_BOT_TOKEN ? makeDiscordNotify(db, site, sendDm) : null,
      ]),
      decided: allOf([
        process.env.TELEGRAM_BOT_TOKEN ? makeTelegramDecided(sendHtml) : null,
        process.env.DISCORD_BOT_TOKEN ? makeDiscordDecided(sendDm) : null,
      ]),
      confirmed: allOf([
        process.env.TELEGRAM_BOT_TOKEN ? makeTelegramConfirmed(db, sendHtml) : null,
        process.env.DISCORD_BOT_TOKEN ? makeDiscordConfirmed(db, sendDm) : null,
      ]),
      investigate: (payment, spender) =>
        buildCase(
          {
            db,
            householdId: spender.household_id,
            payment,
            search: searchProducts,
            getAuthorization,
            ...(process.env.KERNEL_API_KEY ? { visit: (url: string) => visitInCloud(url) } : {}),
            spot: (input) =>
              spotTheDifference(
                {
                  db,
                  householdId: spender.household_id,
                  imageSearch: searchByImage,
                  priceHigh,
                  perHousehold: cap("SPOT_IMAGE_CHECKS_PER_FAMILY", 10),
                  overall: cap("SPOT_IMAGE_CHECKS_PER_DAY", 200),
                },
                input,
              ),
            offers: new Map(),
          },
          { who: { name: spender.name, kind: spender.kind } },
        ),
      defer: (task) => {
        // Inside a request the case is built after the response goes out; outside one (scripts) it runs now.
        try {
          after(task);
        } catch (e) {
          console.error("[spotter] after() unavailable, running the follow up now:", e instanceof Error ? e.message : e);
          task().catch((err) => console.error("[spotter] follow up failed:", err));
        }
      },
      paypal: { createAuthorizeOrder, captureAuthorization, voidAuthorization, getAuthorization },
    } satisfies Deps;
  })().catch((e) => {
    ready = null; // retry on the next request instead of failing forever
    throw e;
  });
  return ready;
}
