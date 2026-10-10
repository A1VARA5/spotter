import { getDeps } from "@/server/deps";
import { reconcileStuck } from "@/core/lifecycle";
import { handleReconcile } from "@/server/cron";

export const maxDuration = 60;

export async function GET(request: Request) {
  return handleReconcile(request, process.env.CRON_SECRET, async () => reconcileStuck(await getDeps(), 30));
}
