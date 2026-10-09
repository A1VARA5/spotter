// Real dependencies for the running app: Postgres, Claude, PayPal sandbox. Seeds the demo spenders once.
import { getDb } from "@/db";
import { aiCheck } from "@/ai/check";
import { captureAuthorization, createAuthorizeOrder, voidAuthorization } from "@/paypal/client";
import { ensureSpender, type Deps } from "@/core/lifecycle";
import { DEMO_SPENDERS } from "./seed";
import { makeMarket } from "@/market/channel3";

let ready: Promise<Deps> | null = null;

export function getDeps(): Promise<Deps> {
  ready ??= (async () => {
    const db = await getDb();
    for (const s of DEMO_SPENDERS) await ensureSpender(db, s);
    return { db, check: (req) => aiCheck(req), market: makeMarket(db), paypal: { createAuthorizeOrder, captureAuthorization, voidAuthorization } } satisfies Deps;
  })().catch((e) => {
    ready = null; // retry on the next request instead of failing forever
    throw e;
  });
  return ready;
}
