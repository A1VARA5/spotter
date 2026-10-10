// Watchtower's AI chat turns. Only an unlocked spotter (PIN, or a demo family) can spend model calls.
import { getDeps } from "@/server/deps";
import { requireSpotter } from "@/server/auth";
import { makeLlmTurn } from "@/watchtower/llm";

export const maxDuration = 60;
let turn: ReturnType<typeof makeLlmTurn> | null = null;

export async function POST(request: Request) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  const body = await request.json().catch(() => null);
  try {
    turn ??= makeLlmTurn({ db: (await getDeps()).db });
    return await turn(s.householdId, body, request.signal);
  } catch (e) {
    console.error(`[spotter] watchtower route failed for ${s.householdId}:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "Watchtower's assistant hit a problem on our side. Try again in a minute." }, { status: 500 });
  }
}
