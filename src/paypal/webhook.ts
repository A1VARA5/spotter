// PayPal webhooks: PayPal tells Spotter when money moves, instead of Spotter only finding out by asking.
// A webhook records truth from PayPal and settles stuck rows. It never captures, voids or creates anything:
// moving money stays with the spotter's tap and the lifecycle.
import { getSpender, settleFromPayPal, type Deps, type Payment } from "@/core/lifecycle";
import type { PaymentStatus } from "@/db/schema";
import { PayPalError, type WebhookHeaders } from "./client";
import { CONSENT_REVOKED, consentRevoked } from "@/core/switchedoff";

export type PayPalEvent = { id: string; event_type: string; resource?: Record<string, unknown> };
export type WebhookDeps = Pick<Deps, "db" | "confirmed" | "defer" | "warn">;
export type HandleResult = { outcome: string; paymentId: string | null };

// Signed doesn't mean well formed: ids go into SQL parameters and logs, so only plain PayPal style ids pass.
const ID = /^[A-Za-z0-9-]{1,64}$/;
const okId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const str = (v: unknown, max = 64) => (typeof v === "string" ? v.slice(0, max) : null);

type Rule = { from: PaymentStatus[]; to: PaymentStatus; error?: string; confirm?: boolean };
// Which statuses each event may settle, and into what. Anything not listed here is only recorded.
const RULES: Record<string, Rule> = {
  // PayPal took the money. Settles a capture that was cut off (capturing, or failed after a timeout).
  "PAYMENT.CAPTURE.COMPLETED": { from: ["needs_approval", "authorised", "capturing", "failed"], to: "captured", confirm: true },
  // Captured, but PayPal is still clearing it. The money has left the hold, so it counts as paid.
  "PAYMENT.CAPTURE.PENDING": { from: ["needs_approval", "authorised", "capturing", "failed"], to: "captured" },
  "PAYMENT.CAPTURE.DENIED": { from: ["capturing", "captured"], to: "failed", error: "PayPal denied the capture, so nothing was paid." },
  // PayPal's event list names the Orders v2 decline DECLINED (DENIED is the v1 name). Same meaning, same rule.
  "PAYMENT.CAPTURE.DECLINED": { from: ["capturing", "captured"], to: "failed", error: "PayPal denied the capture, so nothing was paid." },
  // The hold is gone. Settles a deny that was cut off, and stops anyone approving a hold PayPal already released.
  "PAYMENT.AUTHORIZATION.VOIDED": { from: ["needs_approval", "authorised", "capturing", "voiding", "failed"], to: "voided", confirm: true },
};

/** Every PayPal id in the event that could point at one of our payments. */
function idsOf(resource: Record<string, unknown>): { resourceId: string | null; candidates: string[] } {
  const related = ((resource.supplementary_data as Record<string, unknown> | undefined)?.related_ids ?? {}) as Record<string, unknown>;
  // A refund names its capture only in its "up" link.
  const links = Array.isArray(resource.links) ? (resource.links as Array<{ rel?: unknown; href?: unknown }>) : [];
  const up = links.find((l) => l.rel === "up" && typeof l.href === "string");
  const upCapture = typeof up?.href === "string" ? /\/captures\/([A-Za-z0-9-]{1,64})$/.exec(up.href)?.[1] : undefined;
  const candidates = [resource.id, related.order_id, related.authorization_id, related.capture_id, upCapture].filter(okId);
  return { resourceId: okId(resource.id) ? resource.id : null, candidates: [...new Set(candidates)] };
}

/** Only small, typed facts are kept; the full payload can carry payer details we don't need. */
function summaryOf(resource: Record<string, unknown>) {
  const amount = resource.amount as { value?: unknown; currency_code?: unknown } | undefined;
  return {
    status: str(resource.status),
    amount: str(amount?.value, 20),
    currency: str(amount?.currency_code, 3),
    expires: str(resource.expiration_time),
  };
}

/** The spotter only hears about payments they were asked about, not every small payment Spotter let through. */
const wasHeld = (p: Payment) => p.status === "needs_approval" || p.status === "voiding" || (!!p.decided_by && p.decided_by !== "Spotter");

export async function handlePayPalEvent(deps: WebhookDeps, evt: PayPalEvent): Promise<HandleResult> {
  const { db } = deps;
  const resource = evt.resource ?? {};
  if (evt.event_type === CONSENT_REVOKED) return revoked(deps, evt, resource);
  const { resourceId, candidates } = idsOf(resource);
  const payment = candidates.length
    ? ((
        await db.query<Payment>(
          "select * from payments where paypal_authorization_id = any($1) or paypal_capture_id = any($1) or paypal_order_id = any($1) order by created_at desc limit 1",
          [candidates],
        )
      )[0] ?? null)
    : null;

  // First sight only: PayPal retries and sometimes sends the same event twice.
  const inserted = await db.query(
    "insert into paypal_events (id, event_type, resource_id, payment_id, summary) values ($1, $2, $3, $4, $5) on conflict (id) do nothing returning id",
    [evt.id, evt.event_type, resourceId, payment?.id ?? null, JSON.stringify(summaryOf(resource))],
  );
  if (!inserted.length) return { outcome: "duplicate", paymentId: payment?.id ?? null };
  if (!payment) return { outcome: "unknown_payment", paymentId: null };

  try {
    return await act(deps, evt, resource, resourceId, payment);
  } catch (e) {
    // Forget the event so PayPal's retry gets a real second chance instead of being skipped as a duplicate.
    await db.query("delete from paypal_events where id = $1", [evt.id]).catch((del) => {
      // Now the retry will be skipped as a duplicate, so this must be loud.
      console.error(`[spotter] paypal event ${evt.id} failed and could not be forgotten; PayPal's retry will be skipped:`, del instanceof Error ? del.message : del);
    });
    throw e;
  }
}

/** Someone disconnected a household's PayPal login from Spotter: its spotter hears straight away. Never touches payments. */
async function revoked(deps: WebhookDeps, evt: PayPalEvent, resource: Record<string, unknown>): Promise<HandleResult> {
  // Only that an account id was there, never the id itself: it identifies a person.
  const summary = { status: null, amount: null, currency: null, expires: null, account: ["user_id", "payer_id", "merchant_id", "sub"].filter((k) => typeof resource[k] === "string") };
  const inserted = await deps.db.query(
    "insert into paypal_events (id, event_type, resource_id, payment_id, summary) values ($1, $2, null, null, $3) on conflict (id) do nothing returning id",
    [evt.id, evt.event_type, JSON.stringify(summary)],
  );
  if (!inserted.length) return { outcome: "duplicate", paymentId: null };
  try {
    const warned = await consentRevoked(deps, evt.id, resource);
    return { outcome: warned ? "spotter_warned" : "unknown_account", paymentId: null };
  } catch (e) {
    // Let PayPal's retry try again rather than skip it as a duplicate.
    await deps.db.query("delete from paypal_events where id = $1", [evt.id]).catch((del) => {
      console.error(`[spotter] paypal event ${evt.id} failed and could not be forgotten; PayPal's retry will be skipped:`, del instanceof Error ? del.message : del);
    });
    throw e;
  }
}

async function act(deps: WebhookDeps, evt: PayPalEvent, resource: Record<string, unknown>, resourceId: string | null, payment: Payment): Promise<HandleResult> {
  const { db } = deps;
  const result = (outcome: string): HandleResult => ({ outcome, paymentId: payment.id });

  if (evt.event_type === "PAYMENT.AUTHORIZATION.CREATED") {
    const expires = str(resource.expiration_time);
    if (!expires || Number.isNaN(Date.parse(expires))) return result("recorded");
    await db.query("update payments set paypal_auth_expires_at = $2 where id = $1", [payment.id, expires]);
    return result("expiry_recorded");
  }

  const rule = RULES[evt.event_type];
  if (!rule) return result("recorded");
  // A denial for some other capture must not undo the one that went through.
  if ((evt.event_type === "PAYMENT.CAPTURE.DENIED" || evt.event_type === "PAYMENT.CAPTURE.DECLINED") && payment.paypal_capture_id && payment.paypal_capture_id !== resourceId) return result("recorded");

  const isCapture = evt.event_type.startsWith("PAYMENT.CAPTURE.");
  const moved = await settleFromPayPal(db, payment.id, rule.from, rule.to, {
    ...(isCapture && rule.to === "captured" && resourceId ? { paypal_capture_id: resourceId } : {}),
    ...(rule.error ? { error: rule.error } : {}),
  });
  if (moved) {
    await db.query("insert into events (payment_id, type, data) values ($1, 'paypal_settled', $2)", [
      payment.id,
      JSON.stringify({ event: evt.event_type, from: payment.status, to: rule.to }),
    ]);
  }
  const now = moved ?? payment;
  if (now.status !== rule.to) {
    // PayPal and Spotter disagree in a way a webhook must not fix on its own (e.g. a capture for a voided hold).
    // Kept on the payment's timeline too, so the spotter's view shows it, not only a log line.
    console.error(`[spotter] paypal ${evt.event_type} for ${payment.id} while it is ${now.status}; left as is`);
    await db.query("insert into events (payment_id, type, data) values ($1, 'paypal_mismatch', $2)", [
      payment.id,
      JSON.stringify({ event: evt.event_type, paypal_event: evt.id, spotter_status: now.status }),
    ]);
    return result("mismatch");
  }
  if (rule.confirm && wasHeld(payment)) await confirm(deps, now);
  return result(moved ? rule.to : "confirmed");
}

/** "PayPal confirmed" note to the spotter. After the response, and never allowed to fail the webhook. */
async function confirm(deps: WebhookDeps, p: Payment) {
  if (!deps.confirmed) return;
  const tell = async () => {
    try {
      const spender = await getSpender(deps.db, p.spender_id);
      if (!spender) throw new Error(`spender ${p.spender_id} not found`);
      await deps.confirmed!(p, spender);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[spotter] paypal confirmation note for ${p.id} failed: ${error}`);
      await deps.db
        .query("insert into events (payment_id, type, data) values ($1, 'confirm_failed', $2)", [p.id, JSON.stringify({ error })])
        .catch((err) => console.error(`[spotter] could not record the failed note for ${p.id}:`, err instanceof Error ? err.message : err));
    }
  };
  if (deps.defer) deps.defer(tell);
  else await tell();
}

let warnedNoId = false;
const MAX_BODY = 256 * 1024;

/** The whole request: config check, headers, raw body, PayPal's verdict, then the event. */
export async function handleWebhookRequest(
  req: Request,
  opts: { webhookId: string | undefined; verify: (h: WebhookHeaders, webhookId: string, raw: string) => Promise<boolean>; deps: () => Promise<WebhookDeps> },
): Promise<Response> {
  if (!opts.webhookId) {
    if (!warnedNoId) console.error("[spotter] PAYPAL_WEBHOOK_ID is not set; refusing PayPal webhooks until it is");
    warnedNoId = true;
    return new Response("webhook not configured", { status: 503 });
  }
  const get = (name: string) => req.headers.get(name);
  const h = {
    authAlgo: get("paypal-auth-algo"),
    certUrl: get("paypal-cert-url"),
    transmissionId: get("paypal-transmission-id"),
    transmissionSig: get("paypal-transmission-sig"),
    transmissionTime: get("paypal-transmission-time"),
  };
  if (Object.values(h).some((v) => !v)) {
    console.error("[spotter] paypal webhook without signature headers");
    return new Response("unauthorised", { status: 401 });
  }
  if (Number(get("content-length") ?? 0) > MAX_BODY) return new Response("too large", { status: 413 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY) return new Response("too large", { status: 413 });
  let evt: PayPalEvent;
  try {
    evt = JSON.parse(raw) as PayPalEvent;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!evt || typeof evt !== "object" || !okId(evt.id) || typeof evt.event_type !== "string" || evt.event_type.length > 100) {
    return new Response("not a PayPal event", { status: 400 });
  }

  let genuine: boolean;
  try {
    genuine = await opts.verify(h as WebhookHeaders, opts.webhookId, raw);
  } catch (e) {
    const status = e instanceof PayPalError ? e.status : 0;
    // PayPal refusing the headers themselves (a 4xx other than rate limiting) means not genuine, not an outage.
    if (status >= 400 && status < 500 && status !== 429) {
      console.error(`[spotter] paypal webhook rejected by the verify API (${status}): ${JSON.stringify({ id: evt.id, transmission: h.transmissionId })}`);
      return new Response("unauthorised", { status: 401 });
    }
    // We couldn't ask PayPal. 503 makes PayPal retry later; nothing is trusted meanwhile.
    console.error("[spotter] paypal webhook verify call failed:", e instanceof Error ? e.message : e);
    return new Response("try again", { status: 503 });
  }
  if (!genuine) {
    console.error(`[spotter] paypal webhook failed verification: ${JSON.stringify({ id: evt.id, transmission: h.transmissionId })}`);
    return new Response("unauthorised", { status: 401 });
  }

  try {
    const r = await handlePayPalEvent(await opts.deps(), evt);
    console.log(`[spotter] paypal ${JSON.stringify(evt.event_type)} ${evt.id}: ${r.outcome}${r.paymentId ? ` (${r.paymentId})` : ""}`);
    return new Response("ok");
  } catch (e) {
    console.error(`[spotter] paypal event ${evt.id} crashed:`, e instanceof Error ? e.message : e);
    return new Response("error", { status: 500 });
  }
}
