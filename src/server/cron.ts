// Vercel calls this once a day. It catches payments left half captured when a PayPal webhook never
// arrived (webhooks settle them in seconds normally). Vercel sends "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from "node:crypto";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function handleReconcile(request: Request, secret: string | undefined, reconcile: () => Promise<number>): Promise<Response> {
  if (!secret) {
    console.error("[spotter] CRON_SECRET is not set, so the daily reconcile can't run");
    return Response.json({ error: "Not configured." }, { status: 503 });
  }
  if (!same(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ error: "No." }, { status: 401 });
  try {
    const settled = await reconcile();
    console.info(`[spotter] daily reconcile settled ${settled} payment(s)`);
    return Response.json({ settled });
  } catch (e) {
    console.error("[spotter] daily reconcile failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Reconcile failed." }, { status: 500 });
  }
}
