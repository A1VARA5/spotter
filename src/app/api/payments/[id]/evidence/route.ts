import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { evidenceResponse } from "@/server/evidence";

export const maxDuration = 15;

// Like the case file and the replay: the signed in household that owns the payment, no PIN (it only reads).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401, headers: { "cache-control": "no-store" } });
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format");
  return evidenceResponse((await getDeps()).db, householdId, id, format);
}
