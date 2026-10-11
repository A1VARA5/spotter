// Real dependencies for the running app: Postgres, Claude, PayPal sandbox, Channel3.
import { getDb } from "@/db";
import { aiCheck } from "@/ai/check";
import { captureAuthorization, createAuthorizeOrder, getAuthorization, reauthorizeAuthorization, voidAuthorization } from "@/paypal/client";
import type { Deps } from "@/core/lifecycle";
import { makeMarket, searchProducts } from "@/market/channel3";
import { after } from "next/server";
import { buildCase } from "@/agents/case";
import { visitInCloud } from "@/agents/kernel";
import { sendHtml } from "@/telegram/api";
import { makeTelegramAsk, makeTelegramConfirmed, makeTelegramDecided, makeTelegramNote, makeTelegramNotify } from "@/telegram/notify";
import { sendDm } from "@/discord/api";
import { makeDiscordAsk, makeDiscordConfirmed, makeDiscordDecided, makeDiscordNote, makeDiscordNotify } from "@/discord/notify";
import type { Payment, Spender } from "@/core/lifecycle";
import { makeEmailAsk, makeEmailNote, makeNotify } from "@/email/alerts";
import { send as sendEmail } from "@/email/agentboxd";
import { makeWarn } from "./warn";

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

type Note = (p: Payment, s: Spender, text: string) => Promise<boolean>;
/** True when at least one channel delivered the note. Failures are named in one error only when none delivered. */
function allOfNotes(notes: Array<Note | null>): Note | undefined {
  const live = notes.filter((n): n is Note => n !== null);
  if (!live.length) return undefined;
  return async (p, s, text) => {
    const results = await Promise.allSettled(live.map((n) => n(p, s, text)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const f of failed) console.error("[spotter] spotter note channel failed:", f.reason instanceof Error ? f.reason.message : f.reason);
    if (results.some((r) => r.status === "fulfilled" && r.value)) return true;
    if (failed.length) throw new Error(failed.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; "));
    return false;
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
      // "Was it you?": one question, on the channel the asked person linked. A channel that isn't set up here
      // throws, so the ask is marked as not delivered and the spotter's alert says to ring them instead.
      ask: async (p, payer, w, to) => {
        const by = {
          telegram: process.env.TELEGRAM_BOT_TOKEN ? makeTelegramAsk(sendHtml) : null,
          discord: process.env.DISCORD_BOT_TOKEN ? makeDiscordAsk(sendDm) : null,
          email: process.env.AGENTBOXD_API_KEY ? makeEmailAsk(site) : null,
        }[w.channel as "telegram" | "discord" | "email"];
        if (!by) throw new Error(`${w.channel ?? "no"} channel isn't set up on this server`);
        await by(p, payer, w, to);
      },
      note: allOfNotes([
        process.env.AGENTBOXD_API_KEY ? makeEmailNote(db, site) : null,
        process.env.TELEGRAM_BOT_TOKEN ? makeTelegramNote(db, sendHtml) : null,
        process.env.DISCORD_BOT_TOKEN ? makeDiscordNote(db, sendDm) : null,
      ]),
      decided: allOf([
        process.env.TELEGRAM_BOT_TOKEN ? makeTelegramDecided(sendHtml) : null,
        process.env.DISCORD_BOT_TOKEN ? makeDiscordDecided(sendDm) : null,
      ]),
      confirmed: allOf([
        process.env.TELEGRAM_BOT_TOKEN ? makeTelegramConfirmed(db, sendHtml) : null,
        process.env.DISCORD_BOT_TOKEN ? makeDiscordConfirmed(db, sendDm) : null,
      ]),
      warn: makeWarn(db, site, {
        ...(process.env.TELEGRAM_BOT_TOKEN ? { telegram: sendHtml } : {}),
        ...(process.env.DISCORD_BOT_TOKEN ? { discord: sendDm } : {}),
        ...(process.env.AGENTBOXD_API_KEY ? { email: sendEmail } : {}),
      }),
      investigate: (payment, spender) =>
        buildCase(
          {
            db,
            householdId: spender.household_id,
            payment,
            search: searchProducts,
            getAuthorization,
            ...(process.env.KERNEL_API_KEY ? { visit: (url: string) => visitInCloud(url) } : {}),
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
      paypal: { createAuthorizeOrder, captureAuthorization, voidAuthorization, getAuthorization, reauthorizeAuthorization },
    } satisfies Deps;
  })().catch((e) => {
    ready = null; // retry on the next request instead of failing forever
    throw e;
  });
  return ready;
}
