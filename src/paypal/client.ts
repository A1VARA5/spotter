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

async function token(): Promise<string> {
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
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

/** Creates an AUTHORIZE order. "card" authorises immediately (agents); "approval_link" needs the payer to approve (people). */
export async function createAuthorizeOrder(
  req: PaymentRequest,
  opts: { source: "card" | "approval_link" },
): Promise<CreatedOrder> {
  const body = {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: req.id,
        description: `${req.payee.name}: ${req.category}`.slice(0, 127),
        amount: { currency_code: req.money.currency, value: toDecimal(req.money.amount) },
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

export async function voidAuthorization(authorizationId: string) {
  const v = await call<{ status?: string }>("POST", `/v2/payments/authorizations/${authorizationId}/void`, {});
  return { status: v.status ?? "VOIDED" };
}

export async function getAuthorization(authorizationId: string): Promise<{ status: string }> {
  const a = await call<{ status?: string }>("GET", `/v2/payments/authorizations/${authorizationId}`);
  if (!a.status) throw new Error("PayPal returned an authorisation without a status");
  return { status: a.status };
}
