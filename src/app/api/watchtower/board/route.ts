// Saves the family's Watchtower board (Studio's getState(), debounced in the page).
import { getDeps } from "@/server/deps";
import { makeWatchtowerStore } from "@/watchtower/store";

export async function PUT(request: Request) {
  try {
    return await makeWatchtowerStore((await getDeps()).db).putBoard(request);
  } catch (e) {
    console.error("[spotter] watchtower board save failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't save the board just now." }, { status: 500 });
  }
}
