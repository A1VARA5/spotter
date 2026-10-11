// Channel3's price.changed webhook (configured in Channel3's dashboard, delivered by Svix; payload in
// docs/channel3/webhooks_event-catalog.md). With CHANNEL3_WEBHOOK_SECRET set (the endpoint's whsec_ signing secret),
// only correctly signed deliveries are accepted. Signed or not, the delivery is only a hint: just its product id is
// used, and Spotter re-reads the real offers from Channel3 before anyone is told anything. Its price and link never are.
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_S = 5 * 60;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/** Svix signing: base64 HMAC-SHA256 of "id.timestamp.body" with the base64 key after "whsec_", any of the space separated v1 signatures. */
export function verifySvix(raw: string, h: SvixHeaders, secret: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (!key.length) return false;
  const expected = Buffer.from(createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${raw}`).digest("base64"));
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const header = (r: Request, name: string) => r.headers.get(`svix-${name}`) ?? r.headers.get(`webhook-${name}`);

export async function handleChannel3Webhook(request: Request, secret: string | undefined, hint: (productId: string) => Promise<number>): Promise<Response> {
  const raw = await request.text();
  if (secret && !verifySvix(raw, { id: header(request, "id"), timestamp: header(request, "timestamp"), signature: header(request, "signature") }, secret)) {
    console.error("[spotter] Channel3 webhook with a missing or wrong signature, ignored");
    return Response.json({ error: "Bad signature." }, { status: 401 });
  }
  if (!secret) console.warn("[spotter] Channel3 webhook accepted unsigned (set CHANNEL3_WEBHOOK_SECRET); used as a hint only");
  let event: { type?: unknown; canonical_product_id?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const id = event?.canonical_product_id;
  if (event?.type !== "price.changed" || typeof id !== "string" || !PRODUCT_ID.test(id)) return Response.json({ ignored: true });
  try {
    return Response.json({ checked: await hint(id) });
  } catch (e) {
    console.error("[spotter] Channel3 webhook check failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Check failed." }, { status: 500 });
  }
}
