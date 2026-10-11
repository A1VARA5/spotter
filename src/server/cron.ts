// Vercel calls this once a day. It catches payments left half captured when a PayPal webhook never
// arrived (webhooks settle them in seconds normally). Vercel sends "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from "node:crypto";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// The same daily run also polls price watches (src/core/watch.ts), so drops are found even without Channel3's webhook.
export async function handleReconcile(
  request: Request,
  secret: string | undefined,
  reconcile: () => Promise<number>,
  watches?: () => Promise<Record<string, number>>,
): Promise<Response> {
  if (!secret) {
    console.error("[spotter] CRON_SECRET is not set, so the daily reconcile can't run");
    return Response.json({ error: "Not configured." }, { status: 503 });
  }
  if (!same(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ error: "No." }, { status: 401 });
  // The two jobs run independently: neither one failing stops or hides the other. Any failure answers 500.
  let money: { settled: number } | { error: string };
  try {
    const settled = await reconcile();
    console.info(`[spotter] daily reconcile settled ${settled} payment(s)`);
    money = { settled };
  } catch (e) {
    console.error("[spotter] daily reconcile failed:", e instanceof Error ? e.message : e);
    money = { error: "Reconcile failed." };
  }
  if (!watches) return Response.json(money, { status: "error" in money ? 500 : 200 });
  let w: Record<string, number> | { error: string };
  try {
    w = await watches();
    console.info("[spotter] daily price watches:", JSON.stringify(w));
  } catch (e) {
    console.error("[spotter] daily price watches failed:", e instanceof Error ? e.message : e);
    w = { error: "Price watches failed." };
  }
  return Response.json({ ...money, watches: w }, { status: "error" in money || "error" in w ? 500 : 200 });
}
