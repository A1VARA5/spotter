// The family's Watchtower chats, listed for AG's thread roster (summaries only).
import { getDeps } from "@/server/deps";
import { makeWatchtowerStore } from "@/watchtower/store";

export async function GET(request: Request) {
  try {
    return await makeWatchtowerStore((await getDeps()).db).listThreads(request);
  } catch (e) {
    console.error("[spotter] watchtower thread list failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't load your chats just now." }, { status: 500 });
  }
}
