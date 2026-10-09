// Unlock with the household's PIN (sets a short lived unlock cookie), and report the session state.
import { getDeps } from "@/server/deps";
import { checkPin, householdFrom, isUnlocked, unlockCookie } from "@/server/auth";

export async function POST(request: Request) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { pin } = (await request.json().catch(() => ({}))) as { pin?: unknown };
  if (typeof pin !== "string") return Response.json({ error: "Enter your PIN." }, { status: 400 });
  const result = await checkPin((await getDeps()).db, householdId, pin.trim());
  if (result === "locked") return Response.json({ error: "Too many wrong tries. Wait 15 minutes, then try again." }, { status: 429 });
  if (result === "wrong") return Response.json({ error: "That PIN isn't right." }, { status: 401 });
  return Response.json({ ok: true }, { headers: { "set-cookie": unlockCookie(householdId) } });
}

export async function GET(request: Request) {
  const householdId = householdFrom(request);
  return Response.json({ signedIn: Boolean(householdId), unlocked: Boolean(householdId && isUnlocked(request, householdId)) });
}
