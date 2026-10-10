import { getDeps } from "@/server/deps";
import { startDemo } from "@/server/demo";
import { createExampleHold } from "@/server/example-hold";
import { householdCookie, unlockCookie } from "@/server/auth";

export async function POST(request: Request) {
  const deps = await getDeps();
  const result = await startDemo(deps.db);
  const origin = new URL(request.url).origin;
  if (result === "limit") return Response.redirect(`${origin}/?demo=full`, 303);
  // One real PayPal sandbox hold to look at straight away. Never holds up the start for long, never fails it.
  const example = await createExampleHold(deps, result.householdId).catch((e) => {
    console.error("[spotter] example hold failed:", e instanceof Error ? e.message : e);
    return "failed" as const;
  });
  const headers = new Headers({ location: `${origin}/dashboard?welcome=demo${example === "created" ? "" : "&example=off"}` });
  headers.append("set-cookie", householdCookie(result.householdId));
  headers.append("set-cookie", unlockCookie(result.householdId));
  return new Response(null, { status: 303, headers });
}
