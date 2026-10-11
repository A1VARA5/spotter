import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { closePeek, safely } from "@/server/peek";

export const maxDuration = 15;

// The same as DELETE /peek, as a POST so navigator.sendBeacon can call it when the tab is closed.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  return safely("closing a look", async () => closePeek((await getDeps()).db, householdId, id));
}
