import { getDeps } from "@/server/deps";
import { requireSpotter } from "@/server/auth";
import { startRequest } from "@/server/was-it-you";

export const maxDuration = 30;

// Starts the side by side demo: a real sandbox hold for the demo family's Gran and an example ask to Tom.
export async function POST(request: Request) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  try {
    return await startRequest(await getDeps(), s.householdId);
  } catch (e) {
    console.error("[spotter] was it you demo crashed:", e);
    return Response.json({ error: "Spotter hit an unexpected error starting the example. Nothing was paid. Try again in a moment." }, { status: 500 });
  }
}
