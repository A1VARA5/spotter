import { getDb } from "@/db";
import { setAgentCurrency } from "@/server/spender-currency";
import { makeSetupHandlers } from "@/server/setup";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return makeSetupHandlers(getDb).removeSpender(request, (await ctx.params).id);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return setAgentCurrency(await getDb(), request, (await ctx.params).id);
}
