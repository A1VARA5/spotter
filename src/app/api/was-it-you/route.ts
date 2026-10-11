import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { answerRequest } from "@/server/was-it-you";

export const maxDuration = 30;

// "Not me" or "Yes, it's me" from the answer page (an email link) or the demo's example phone.
export async function POST(request: Request) {
  try {
    return await answerRequest(await getDeps(), request, householdFrom(request));
  } catch (e) {
    console.error("[spotter] was it you answer crashed:", e);
    return Response.json({ error: "Spotter hit an unexpected error. Nothing was paid. Try again in a moment." }, { status: 500 });
  }
}
