import { getDeps } from "@/server/deps";
import { reconcileStuck } from "@/core/lifecycle";
import { askAgainDue, keepHoldsAlive } from "@/core/sleep";
import { handleDaily } from "@/server/cron";

export const maxDuration = 60;

export async function GET(request: Request) {
  return handleDaily(request, process.env.CRON_SECRET, {
    settled: async () => reconcileStuck(await getDeps(), 30),
    renewed: async () => keepHoldsAlive(await getDeps()),
    askedAgain: async () => askAgainDue(await getDeps()),
  });
}
