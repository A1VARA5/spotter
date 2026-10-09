import { getDb } from "@/db";
import { makeSetupHandlers } from "@/server/setup";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return makeSetupHandlers(getDb).agentToken(request, (await ctx.params).id);
}
