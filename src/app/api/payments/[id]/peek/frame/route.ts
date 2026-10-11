import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { peekFrame, safely } from "@/server/peek";

export const maxDuration = 15;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  return safely("a picture", async () => peekFrame((await getDeps()).db, householdId, id));
}
