import { getDeps } from "@/server/deps";
import { reconcileStuck } from "@/core/lifecycle";
import { askAgainDue, keepHoldsAlive } from "@/core/sleep";
import { handleDaily } from "@/server/cron";
import { runWatches } from "@/core/watch";
import { getWatchDeps } from "@/server/watch-deps";

// Four independent jobs, two of them calling PayPal or Channel3 per row.
export const maxDuration = 120;

// The jobs share one clock: price watches get what's left of it, so the route ends before Vercel cuts it off.
const JOB_MS = 100_000;

export async function GET(request: Request) {
  const began = Date.now();
  return handleDaily(request, process.env.CRON_SECRET, {
    settled: async () => reconcileStuck(await getDeps(), 30),
    renewed: async () => keepHoldsAlive(await getDeps()),
    askedAgain: async () => askAgainDue(await getDeps()),
    watches: async () => runWatches(await getWatchDeps(), Math.max(0, JOB_MS - (Date.now() - began))),
  });
}
