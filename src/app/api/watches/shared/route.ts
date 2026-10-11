// The shared live price watch for demo families (src/core/shared-watch.ts). Opening the Price watches dialog calls
// this; Channel3 is asked at most once an hour, otherwise the stored history is returned.
import { householdFrom } from "@/server/auth";
import { getWatchDeps } from "@/server/watch-deps";
import { sharedWatchFor } from "@/core/shared-watch";

export const maxDuration = 30;

export async function GET(request: Request) {
  const hh = householdFrom(request);
  if (!hh) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const shared = await sharedWatchFor(await getWatchDeps(), hh);
    if (!shared) return Response.json({ error: "The shared price watch is for demo families." }, { status: 404 });
    return Response.json({ shared });
  } catch (e) {
    console.error("[spotter] loading the shared price watch failed:", e);
    return Response.json({ error: "Couldn't load the shared price watch." }, { status: 500 });
  }
}
