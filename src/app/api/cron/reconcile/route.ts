import { getDeps } from "@/server/deps";
import { reconcileStuck } from "@/core/lifecycle";
import { askAgainDue, keepHoldsAlive } from "@/core/sleep";
import { handleDaily } from "@/server/cron";
import { runWatches } from "@/core/watch";
import { getWatchDeps } from "@/server/watch-deps";

// Four independent jobs, two of them calling PayPal or Channel3 per row.
export const maxDuration = 120;

export async function GET(request: Request) {
  return handleDaily(request, process.env.CRON_SECRET, {
    settled: async () => reconcileStuck(await getDeps(), 30),
    renewed: async () => keepHoldsAlive(await getDeps()),
    askedAgain: async () => askAgainDue(await getDeps()),
    watches: async () => runWatches(await getWatchDeps()),
  });
}
