import { getDb } from "@/db";
import { makeSetupHandlers } from "@/server/setup";
import { toolkitReadOrder } from "@/paypal/toolkit";

export const maxDuration = 20;

// The agent key card: label, job, allowance left, status, last tool calls, and PayPal's own record of the newest order.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return makeSetupHandlers(getDb).keyCard(request, (await ctx.params).id, toolkitReadOrder);
}
