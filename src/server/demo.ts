// "Try the demo family": a fresh, private household per visitor, already unlocked, PIN 2468.
import type { Db } from "@/db";
import { createDemoHousehold, deleteStaleDemoHouseholds } from "@/core/households";
import { setPin } from "./auth";
import { DEMO_PIN } from "./seed";

export const DEMO_DAILY_CAP = Number(process.env.SPOTTER_DEMO_DAILY_CAP ?? 200);
let lastSweep = 0;

export async function startDemo(db: Db, cap = DEMO_DAILY_CAP): Promise<{ householdId: string } | "limit"> {
  if (Date.now() - lastSweep > 60 * 60 * 1000) {
    lastSweep = Date.now();
    await deleteStaleDemoHouseholds(db, 48);
  }
  const [row] = await db.query<{ n: string }>("select count(*)::text as n from households where demo and created_at > now() - interval '1 day'");
  if (Number(row?.n ?? 0) >= cap) return "limit";
  const hh = await createDemoHousehold(db);
  await setPin(db, hh.id, DEMO_PIN);
  return { householdId: hh.id };
}
