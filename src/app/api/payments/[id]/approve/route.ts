import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";

const h = makeHandlers(getDeps);
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return h.approve(id, "spotter");
}
