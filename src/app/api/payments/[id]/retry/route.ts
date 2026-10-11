import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";

const h = makeHandlers(getDeps);
export const maxDuration = 30;

// "Try PayPal again": finishes a capture or void PayPal didn't confirm, with the same PayPal-Request-Id. It never makes a
// new decision (the spotter's tap already did), so the signed in household is enough.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  return h.retry(householdId, id);
}
