import { householdFrom } from "@/server/auth";
import { getWatchDeps } from "@/server/watch-deps";
import { stopWatch } from "@/core/watch";

export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const hh = householdFrom(request);
  if (!hh) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const r = await stopWatch(await getWatchDeps(), hh, id);
    return "watch" in r ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    console.error("[spotter] stopping a price watch failed:", e);
    return Response.json({ error: "Spotter couldn't stop watching. Try again in a minute." }, { status: 500 });
  }
}
