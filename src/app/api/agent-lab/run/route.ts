// "Hijack the agent": runs the scripted naive test agent against Spotter's guarded toolkit and streams each step as a
// line of JSON. Signed in (the demo family counts) only; capped per family per day inside runLab.
import { getDeps } from "@/server/deps";
import { householdFrom } from "@/server/auth";
import { getHousehold } from "@/core/households";
import { runLab } from "@/server/agent-lab";
import { toolkitReadOrder, toolkitRun } from "@/paypal/toolkit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Start the demo first, then run the lab." }, { status: 401 });
  const deps = await getDeps();
  if (!(await getHousehold(deps.db, householdId))) return Response.json({ error: "Start the demo first, then run the lab." }, { status: 401 });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // After the browser leaves, enqueue throws: that ends the loop, and runLab's finally lets go of the hold.
      try {
        for await (const s of runLab(deps, householdId, { read: toolkitReadOrder, run: (m, a, o) => toolkitRun(m, a, o) })) {
          controller.enqueue(enc.encode(JSON.stringify(s) + "\n"));
        }
      } catch (e) {
        console.error("[spotter] agent lab stream crashed or the browser left:", e instanceof Error ? e.message : e);
        try {
          controller.enqueue(enc.encode(JSON.stringify({ kind: "error", title: "The run stopped part way", detail: "Spotter hit an unexpected error. Nothing was paid.", at: new Date().toISOString() }) + "\n"));
        } catch {
          // the browser is gone: nothing left to tell
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a cancelled request
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
