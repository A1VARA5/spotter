import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";
import { requireSpotter } from "@/server/auth";
import { getHousehold } from "@/core/households";
import { checkApproval } from "@/server/approval";

const h = makeHandlers(getDeps);
export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const { db } = await getDeps();
  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const refused = await checkApproval(db, s.householdId, id, body?.pin);
  if (refused) return refused;
  const hh = await getHousehold(db, s.householdId);
  return h.approve(s.householdId, id, hh?.spotter_name ?? "spotter");
}
