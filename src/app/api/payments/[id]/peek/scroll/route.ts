import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { peekScroll, safely } from "@/server/peek";

export const maxDuration = 15;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { direction?: unknown };
  return safely("scrolling", async () => peekScroll((await getDeps()).db, householdId, id, body.direction as "up" | "down"));
}
