import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { dismissWarning } from "@/core/switchedoff";

// Dismissing a warning only hides it on the dashboard; the signed in household that owns it is enough.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const ok = await dismissWarning((await getDeps()).db, householdId, id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "No such warning." }, { status: 404 });
}
