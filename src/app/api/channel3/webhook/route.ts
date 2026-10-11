// Channel3's price.changed webhook. Set this URL in Channel3's dashboard and CHANNEL3_WEBHOOK_SECRET to the
// endpoint's signing secret. The delivery is only a hint: see src/market/webhook.ts.
import { handleChannel3Webhook } from "@/market/webhook";
import { getWatchDeps } from "@/server/watch-deps";
import { hintFromWebhook } from "@/core/watch";

export const maxDuration = 30;

export async function POST(request: Request) {
  return handleChannel3Webhook(request, process.env.CHANNEL3_WEBHOOK_SECRET || undefined, async (productId) => hintFromWebhook(await getWatchDeps(), productId));
}
