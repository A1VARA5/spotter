import { getDeps } from "@/server/deps";
import { startDemo } from "@/server/demo";
import { householdCookie, unlockCookie } from "@/server/auth";

export async function POST(request: Request) {
  const result = await startDemo((await getDeps()).db);
  const origin = new URL(request.url).origin;
  if (result === "limit") return Response.redirect(`${origin}/?demo=full`, 303);
  const headers = new Headers({ location: `${origin}/dashboard?welcome=demo` });
  headers.append("set-cookie", householdCookie(result.householdId));
  headers.append("set-cookie", unlockCookie(result.householdId));
  return new Response(null, { status: 303, headers });
}
