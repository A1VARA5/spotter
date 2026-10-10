// Live real shop prices for Watchtower's Spotter agent (Channel3, through the payment check's cache).
// Same gate as the assistant itself: an unlocked spotter (PIN, or a demo family).
import { getDeps } from "@/server/deps";
import { requireSpotter } from "@/server/auth";
import { makeMarket } from "@/market/channel3";
import { makePriceCheck } from "@/watchtower/price";

let check: ReturnType<typeof makePriceCheck> | null = null;

export async function POST(request: Request) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  const body = await request.json().catch(() => null);
  try {
    const { db } = await getDeps();
    check ??= makePriceCheck({ db, market: makeMarket(db) });
    return await check(s.householdId, body);
  } catch (e) {
    console.error(`[spotter] watchtower price route failed for ${s.householdId}:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "The price check hit a problem on our side. Try again in a minute." }, { status: 500 });
  }
}
