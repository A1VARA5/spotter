// Watchtower polls this every 15 seconds while the tab is visible: anything new since <time>?
import { getDeps } from "@/server/deps";
import { makeLive } from "@/watchtower/live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await makeLive((await getDeps()).db)(request);
  } catch (e) {
    console.error("[spotter] watchtower live check failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't check for changes just now." }, { status: 500 });
  }
}
