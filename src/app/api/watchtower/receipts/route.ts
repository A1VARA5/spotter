// The family's AI receipts: what Watchtower's assistant did in each run (tool names, counts, times).
import { getDeps } from "@/server/deps";
import { makeReceiptStore } from "@/watchtower/receipts";

export async function GET(request: Request) {
  try {
    return await makeReceiptStore((await getDeps()).db).list(request);
  } catch (e) {
    console.error("[spotter] watchtower receipts list failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't load the assistant's receipts just now." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return await makeReceiptStore((await getDeps()).db).post(request);
  } catch (e) {
    console.error("[spotter] watchtower receipt save failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't keep that receipt just now." }, { status: 500 });
  }
}
