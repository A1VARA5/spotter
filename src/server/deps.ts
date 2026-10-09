// Real dependencies for the running app: Postgres, Claude, PayPal sandbox, Channel3.
import { getDb } from "@/db";
import { aiCheck } from "@/ai/check";
import { captureAuthorization, createAuthorizeOrder, getAuthorization, voidAuthorization } from "@/paypal/client";
import type { Deps } from "@/core/lifecycle";
import { makeMarket } from "@/market/channel3";
import { makeNotify } from "@/email/alerts";

let ready: Promise<Deps> | null = null;

export function getDeps(): Promise<Deps> {
  ready ??= (async () => {
    const db = await getDb();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://spotter-pay.vercel.app";
    return { db, check: (req) => aiCheck(req), market: makeMarket(db), notify: process.env.AGENTBOXD_API_KEY ? makeNotify(db, site) : undefined, paypal: { createAuthorizeOrder, captureAuthorization, voidAuthorization, getAuthorization } } satisfies Deps;
  })().catch((e) => {
    ready = null; // retry on the next request instead of failing forever
    throw e;
  });
  return ready;
}
