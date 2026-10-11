import { getDb } from "@/db";
import { makeSetupHandlers } from "@/server/setup";

// "Switch off now": the agent's key and decoy stop working, and no new key is made.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return makeSetupHandlers(getDb).keyOff(request, (await ctx.params).id);
}
