import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";
import { isSpotter, notSpotter } from "@/server/auth";

const h = makeHandlers(getDeps);
export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSpotter(request)) return notSpotter();
  const { id } = await ctx.params;
  return h.approve(id, "spotter");
}
