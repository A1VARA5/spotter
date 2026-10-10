import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { replayVideo } from "@/server/replay";

export const maxDuration = 20;

// Watching is like reading the case file: the signed in household is enough, no PIN.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  return replayVideo((await getDeps()).db, householdId, id, request);
}
