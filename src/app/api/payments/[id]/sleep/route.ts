import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { getHousehold } from "@/core/households";
import { getPayment, getSpender } from "@/core/lifecycle";

const h = makeHandlers(getDeps);
export const maxDuration = 15;

// "Ask again tomorrow" only makes the hold wait (it never pays or releases anything), so like reading the case file
// the signed in household is enough, no PIN: that lets the simple view offer it to the person being looked after.
// {"as": "person"} only changes the name written on the timeline.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { as?: unknown };
  const db = (await getDeps()).db;
  let by = (await getHousehold(db, householdId))?.spotter_name ?? "spotter";
  if (body.as === "person") {
    const p = await getPayment(db, id, householdId);
    const s = p ? await getSpender(db, p.spender_id) : null;
    if (s) by = s.name;
  }
  return h.sleep(householdId, id, by);
}
