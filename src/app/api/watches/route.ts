// Price watches for the signed in family. Watching a price moves no money, so it needs the spotter's session but
// not the PIN. Capped per family and per day in src/core/watch.ts (Channel3 charges per tracked product per day).
import { householdFrom } from "@/server/auth";
import { getWatchDeps } from "@/server/watch-deps";
import { listWatches, watchFromPayment, watchUpdates } from "@/core/watch";

export const maxDuration = 30;

export async function GET(request: Request) {
  const hh = householdFrom(request);
  if (!hh) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    return Response.json({ watches: await listWatches((await getWatchDeps()).db, hh), updates: watchUpdates() });
  } catch (e) {
    console.error("[spotter] listing price watches failed:", e);
    return Response.json({ error: "Couldn't load price watches." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const hh = householdFrom(request);
  if (!hh) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { paymentId?: unknown } | null;
  if (typeof body?.paymentId !== "string" || body.paymentId.length > 64) return Response.json({ error: "Say which payment." }, { status: 400 });
  try {
    const r = await watchFromPayment(await getWatchDeps(), hh, body.paymentId);
    return "watch" in r ? Response.json({ ...r, updates: watchUpdates() }, { status: 201 }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    console.error("[spotter] starting a price watch failed:", e);
    return Response.json({ error: "Spotter couldn't start watching the price. Try again in a minute." }, { status: 500 });
  }
}
