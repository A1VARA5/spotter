import { getDeps } from "@/server/deps";
import { reconcileStuck } from "@/core/lifecycle";
import { askAgainDue, keepHoldsAlive } from "@/core/sleep";
import { handleDaily } from "@/server/cron";
import { runWatches } from "@/core/watch";
import { getWatchDeps } from "@/server/watch-deps";
import { sharedWatch } from "@/core/shared-watch";

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
    // The demo families' shared live watch: its Channel3 history, once a day even if nobody opened it.
    sharedWatch: async () => {
      const v = await sharedWatch(await getWatchDeps(), "daily");
      // unreachableAt is cleared on every good answer, so it is set exactly when the latest try (this one or a panel's) failed.
      if (v.problem) throw new Error(v.problem === "not_found" ? "Channel3 can't track the shared price watch's product" : "Channel3 didn't answer for the shared price watch");
      if (!v.lastCheckedAt || Date.now() - Date.parse(v.lastCheckedAt) > 25 * 3_600_000) throw new Error("The shared price watch hasn't been checked for over a day");
      return v.points.length;
    },
  });
}
