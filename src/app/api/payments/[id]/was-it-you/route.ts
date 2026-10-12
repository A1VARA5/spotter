import { z } from "zod";
import { getDeps } from "@/server/deps";
import { requireSpotter } from "@/server/auth";
import { answerOnDashboard } from "@/server/was-it-you";

export const maxDuration = 30;

const Body = z.object({ answer: z.enum(["not_me", "it_was_me"]) });

// "Was it you?" answered on the dashboard: the spotter's own question (no alert channel needed) or the Try demo's
// example ask left behind. Unlocked like Deny, because Not me cancels the hold.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  const b = Body.safeParse(await request.json().catch(() => null));
  if (!b.success) return Response.json({ error: "Send an answer: not_me or it_was_me." }, { status: 400 });
  const { id } = await ctx.params;
  try {
    return await answerOnDashboard(await getDeps(), s.householdId, id, b.data.answer);
  } catch (e) {
    console.error(`[spotter] was it you dashboard answer for ${id} crashed:`, e);
    return Response.json({ error: "Spotter hit an unexpected error. Nothing was paid. Try again in a moment." }, { status: 500 });
  }
}
