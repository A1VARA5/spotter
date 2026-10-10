import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { closePeek, safely, startPeek } from "@/server/peek";

export const maxDuration = 30;

// Looking is like reading the case file: the signed in household is enough, no PIN. The page comes from the
// payment's own case file, never from the request.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { view?: unknown };
  const view = body.view === "phone" ? "phone" : "desktop";
  return safely("starting a look", async () => startPeek((await getDeps()).db, householdId, id, view));
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  return safely("closing a look", async () => closePeek((await getDeps()).db, householdId, id));
}
