import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";
import { householdFrom, requireSpotter } from "@/server/auth";

const h = makeHandlers(getDeps);

// The web form is the spotter trying a request on behalf of one of their people.
export async function POST(request: Request) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  return h.submit(s.householdId, request);
}

export async function GET(request: Request) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  return h.list(householdId);
}
