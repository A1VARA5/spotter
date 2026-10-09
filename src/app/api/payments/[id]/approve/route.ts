import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";
import { requireSpotter } from "@/server/auth";
import { getHousehold } from "@/core/households";

const h = makeHandlers(getDeps);
export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const hh = await getHousehold((await getDeps()).db, s.householdId);
  return h.approve(s.householdId, id, hh?.spotter_name ?? "spotter");
}
