// Channel3's price.changed webhook. Set this URL in Channel3's dashboard and CHANNEL3_WEBHOOK_SECRET to the
// endpoint's signing secret. The delivery is only a hint: see src/market/webhook.ts.
import { handleChannel3Webhook } from "@/market/webhook";
import { getWatchDeps } from "@/server/watch-deps";
import { hintFromWebhook } from "@/core/watch";
import { DEMO_SHARED_WATCH, sharedWatch } from "@/core/shared-watch";

export const maxDuration = 30;

export async function POST(request: Request) {
  return handleChannel3Webhook(request, process.env.CHANNEL3_WEBHOOK_SECRET || undefined, async (productId) => {
    const deps = await getWatchDeps();
    const checked = await hintFromWebhook(deps, productId);
    // The demo families' shared watch re-reads its history from Channel3 (never the webhook's price), at most every 10 minutes.
    // Its failure is logged, not answered as a failed delivery: the hint above already ran and Svix would redo it.
    if (productId === DEMO_SHARED_WATCH.productId) {
      await sharedWatch(deps, "daily").catch((e: unknown) => console.error("[spotter] refreshing the shared price watch from a Channel3 webhook failed:", e instanceof Error ? e.message : e));
    }
    return checked;
  });
}
