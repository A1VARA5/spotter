import { getDb } from "@/db";
import { makeSetupHandlers } from "@/server/setup";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return makeSetupHandlers(getDb).removeSpender(request, (await ctx.params).id);
}
