// PayPal REST v2, sandbox only. See docs/paypal-notes.md for the flows this was proven against.
import type { PaymentRequest } from "@/core/types";

const BASE = "https://api-m.sandbox.paypal.com";
const TIMEOUT_MS = 15_000;

/** PayPal (or a proxy in front of it) can answer with HTML; never let that become "Unexpected token <". */
function parseBody(text: string): Record<string, any> {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: `Non JSON reply from PayPal: ${text.slice(0, 120)}` };
  }
}

// The demo "saved card" for agents (PayPal sandbox test card). Never a real card.
const SANDBOX_CARD = {
  number: "4111111111111111",
  expiry: "2030-12",
  security_code: "123",
  name: "Spotter Demo",
  billing_address: { address_line_1: "1 Test Street", admin_area_2: "London", postal_code: "SW1A 1AA", country_code: "GB" },
};

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public issue?: string,
    public debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export const toDecimal = (minor: number) => (minor / 100).toFixed(2);

let cached: { token: string; expiresAt: number } | null = null;
export const resetTokenCache = () => {
  cached = null;
};

/** A sandbox access token for Spotter's PayPal app (cached). The toolkit's read tools use it too. */
export async function token(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new PayPalError("PayPal sandbox credentials are missing", 0, "MISSING_CREDENTIALS");
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = parseBody(await r.text()) as { access_token?: string; expires_in?: number };
  if (!r.ok || !j.access_token) throw new PayPalError("PayPal token request failed", r.status, "AUTH_FAILED");
  cached = { token: j.access_token, expiresAt: Date.now() + ((j.expires_in ?? 300) - 60) * 1000 };
  return j.access_token;
}

async function call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    return fetch(`${BASE}${path}`, {
      method,
      headers,
      // A string body is already JSON (the webhook check must pass PayPal's event bytes through untouched).
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };
  let r = await send();
  // A token can stop working before its expires_in (PayPal: "If you get a 401, don't panic"). Get a new
  // one and ask once more. The request id is the same, so a money call can't happen twice.
  if (r.status === 401) {
    cached = null;
    r = await send();
  }
  const j = parseBody(await r.text());
  if (!r.ok) {
    throw new PayPalError(j.message ?? `PayPal ${method} ${path} failed`, r.status, j.details?.[0]?.issue ?? j.name, j.debug_id);
  }
  return j as T;
}

type OrderResponse = {
  id: string;
  status: string;
  links?: Array<{ rel: string; href: string }>;
  purchase_units?: Array<{ payments?: { authorizations?: Array<{ id: string; expiration_time: string }> } }>;
};

export type CreatedOrder = { orderId: string; authorizationId?: string; expiresAt?: string; approveUrl?: string };

/**
 * Creates an AUTHORIZE order. "card" authorises immediately (agents); "approval_link" needs the payer to approve (people).
 * Every order carries invoice_id = spotter-<payment id>: PayPal refuses a second order with the same invoice_id, so a
 * duplicate can't be made even past our own checks. customId (an agent's key and the payment id) is PayPal's own record
 * of which agent key asked for the order: PayPal returns it in get_order and its reports, and never shows it to the payer.
 * "replay" asks again for a card order whose answer never arrived: the same PayPal-Request-Id without the card. PayPal
 * then answers with the order it already made, and the authorisation (sandbox, 2026-10-11). Repeating the card itself
 * was refused (422 TRANSACTION_REFUSED). Without the card a replay can never make a new hold.
 */
export async function createAuthorizeOrder(
  req: PaymentRequest,
  opts: { source: "card" | "approval_link" | "replay"; customId?: string },
): Promise<CreatedOrder> {
  const body = {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: req.id,
        description: `${req.payee.name}: ${req.category}`.slice(0, 127),
        amount: { currency_code: req.money.currency, value: toDecimal(req.money.amount) },
        invoice_id: `spotter-${req.id}`.slice(0, 127),
        ...(opts.customId ? { custom_id: opts.customId.slice(0, 127) } : {}),
      },
    ],
    ...(opts.source === "card" ? { payment_source: { card: SANDBOX_CARD } } : {}),
  };
  const o = await call<OrderResponse>("POST", "/v2/checkout/orders", body, `create-${req.id}`);
  const auth = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  return {
    orderId: o.id,
    ...(auth ? { authorizationId: auth.id, expiresAt: auth.expiration_time } : {}),
    ...(o.links?.find((l) => l.rel === "approve") ? { approveUrl: o.links.find((l) => l.rel === "approve")!.href } : {}),
  };
}

/** A finished sale for a family that sells (core/selling.ts), paid at once with the sandbox test card. Demo only:
 * it gives the selling agent's refund and tracking guards a real PayPal capture to check against. */
export async function createExampleSale(s: { amount: number; currency: string; item: string; ref: string }): Promise<{ orderId: string; captureId: string }> {
  const body = {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: s.ref, description: s.item.slice(0, 127), amount: { currency_code: s.currency, value: toDecimal(s.amount) } }],
    payment_source: { card: SANDBOX_CARD },
  };
  const o = await call<{ id: string; status: string; purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string }> } }> }>(
    "POST",
    "/v2/checkout/orders",
    body,
    `sale-${s.ref}`,
  );
  const capture = o.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture?.id || capture.status !== "COMPLETED") throw new PayPalError(`PayPal didn't complete the capture (order ${o.status})`, 200, "NO_CAPTURE");
  return { orderId: o.id, captureId: capture.id };
}

/** After the payer approved an approval_link order. */
export async function authorizeOrder(orderId: string): Promise<{ authorizationId: string; expiresAt: string }> {
  const o = await call<OrderResponse>("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, `authorize-${orderId}`);
  const auth = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new PayPalError("No authorisation returned", 200, "NO_AUTHORIZATION");
  return { authorizationId: auth.id, expiresAt: auth.expiration_time };
}

export async function captureAuthorization(authorizationId: string, idempotencyKey: string) {
  const c = await call<{ id: string; status: string }>(
    "POST",
    `/v2/payments/authorizations/${authorizationId}/capture`,
    {},
    idempotencyKey,
  );
  return { captureId: c.id, status: c.status };
}

/** idempotencyKey: the same key for the same payment and authorisation, so a retried void is one request at PayPal. */
export async function voidAuthorization(authorizationId: string, idempotencyKey?: string) {
  const v = await call<{ status?: string }>("POST", `/v2/payments/authorizations/${authorizationId}/void`, {}, idempotencyKey);
  return { status: v.status ?? "VOIDED" };
}

/** A fresh hold for a payment still waiting after PayPal's 3 day honor period. PayPal allows it once, day 4 to 29, and
 * answers with a NEW authorisation id: capture and void must use that one from now on (docs/paypal-notes.md). */
export async function reauthorizeAuthorization(authorizationId: string, idempotencyKey: string): Promise<{ authorizationId: string; expiresAt?: string }> {
  const a = await call<{ id?: string; expiration_time?: string }>("POST", `/v2/payments/authorizations/${authorizationId}/reauthorize`, {}, idempotencyKey);
  if (!a.id) throw new PayPalError("PayPal reauthorised without an authorisation id", 200, "NO_AUTHORIZATION");
  return { authorizationId: a.id, ...(a.expiration_time ? { expiresAt: a.expiration_time } : {}) };
}

export async function getAuthorization(authorizationId: string): Promise<{ status: string; expiresAt?: string }> {
  const a = await call<{ status?: string; expiration_time?: string }>("GET", `/v2/payments/authorizations/${authorizationId}`);
  if (!a.status) throw new Error("PayPal returned an authorisation without a status");
  return { status: a.status, ...(a.expiration_time ? { expiresAt: a.expiration_time } : {}) };
}

export type WebhookHeaders = { authAlgo: string; certUrl: string; transmissionId: string; transmissionSig: string; transmissionTime: string };

/** Asks PayPal whether a webhook really came from it. PayPal fetches and checks the cert itself, so we never
 * touch cert_url. The event goes back as the exact raw bytes: re-serialising can change numbers (1.10 -> 1.1)
 * and break the signature. Throws if PayPal can't be asked, so the caller can answer "try again later". */
export async function verifyWebhookSignature(h: WebhookHeaders, webhookId: string, rawEvent: string): Promise<boolean> {
  const head = JSON.stringify({
    auth_algo: h.authAlgo,
    cert_url: h.certUrl,
    transmission_id: h.transmissionId,
    transmission_sig: h.transmissionSig,
    transmission_time: h.transmissionTime,
    webhook_id: webhookId,
  });
  const body = `${head.slice(0, -1)},"webhook_event":${rawEvent}}`;
  const r = await call<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", body);
  return r.verification_status === "SUCCESS";
}
