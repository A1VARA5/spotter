import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureAuthorization,
  createAuthorizeOrder,
  createExampleSale,
  PayPalError,
  reauthorizeAuthorization,
  resetTokenCache,
  toDecimal,
  verifyWebhookSignature,
  voidAuthorization,
} from "./client";
import type { PaymentRequest } from "@/core/types";

const req: PaymentRequest = {
  id: "p1",
  spenderId: "s1",
  money: { amount: 1250, currency: "GBP" },
  payee: { name: "Gift Shop", isNew: false },
  category: "gifts",
  method: "paypal_order",
  context: "",
  createdAt: "2026-10-09T12:00:00Z",
};

type Call = { url: string; init: RequestInit };
let calls: Call[];

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[i++] ?? { status: 500, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
}

const TOKEN = { status: 200, body: { access_token: "tok", expires_in: 32000 } };
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

beforeEach(() => {
  process.env.PAYPAL_CLIENT_ID = "id";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  resetTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("toDecimal", () => {
  it("turns minor units into PayPal decimal strings", () => {
    expect(toDecimal(1250)).toBe("12.50");
    expect(toDecimal(5)).toBe("0.05");
    expect(toDecimal(100000)).toBe("1000.00");
  });
});

describe("paypal client", () => {
  it("only talks to the sandbox", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "O1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "A1", expiration_time: "x" }] } }] } }]);
    await createAuthorizeOrder(req, { source: "card" });
    expect(calls.every((c) => c.url.startsWith("https://api-m.sandbox.paypal.com/"))).toBe(true);
  });

  it("caches the token across calls", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "C1", status: "COMPLETED" } }, { status: 201, body: { id: "C2", status: "COMPLETED" } }]);
    await captureAuthorization("A1", "k1");
    await captureAuthorization("A2", "k2");
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });

  it("sends the amount as a decimal and an idempotency key on create", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "O1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "A1", expiration_time: "2026-11-07T00:00:00Z" }] } }] } }]);
    const r = await createAuthorizeOrder(req, { source: "card" });
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "GBP", value: "12.50" });
    expect(header(calls[1]!, "PayPal-Request-Id")).toBe("create-p1");
    expect(r).toEqual({ orderId: "O1", authorizationId: "A1", expiresAt: "2026-11-07T00:00:00Z" });
  });

  it("returns the approve link when the buyer has to approve", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "O2", status: "CREATED", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=O2" }] } }]);
    const r = await createAuthorizeOrder(req, { source: "approval_link" });
    expect(r.approveUrl).toContain("checkoutnow");
    expect(JSON.parse(String(calls[1]!.init.body)).payment_source).toBeUndefined();
  });

  it("a replay repeats the create's PayPal-Request-Id without the card, so it can only find the order PayPal made", async () => {
    // Sandbox, 2026-10-11: repeating the card body with the same id answers 422 TRANSACTION_REFUSED; without the
    // card PayPal answers 200 with the original order and its authorisation (docs/paypal-notes.md).
    mockFetch([TOKEN, { status: 200, body: { id: "O1", status: "CREATED", purchase_units: [{ payments: { authorizations: [{ id: "A1", expiration_time: "x" }] } }] } }]);
    const r = await createAuthorizeOrder(req, { source: "replay", customId: "spt-abcd:p1" });
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(header(calls[1]!, "PayPal-Request-Id")).toBe("create-p1");
    expect(body.payment_source).toBeUndefined();
    expect(body.purchase_units[0]).toMatchObject({ invoice_id: "spotter-p1", custom_id: "spt-abcd:p1" });
    expect(r).toMatchObject({ orderId: "O1", authorizationId: "A1" });
  });

  it("uses the given idempotency key on capture", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "C1", status: "COMPLETED" } }]);
    const r = await captureAuthorization("A1", "capture-p1");
    expect(header(calls[1]!, "PayPal-Request-Id")).toBe("capture-p1");
    expect(r).toEqual({ captureId: "C1", status: "COMPLETED" });
  });

  it("turns a PayPal error into PayPalError with the issue", async () => {
    mockFetch([TOKEN, { status: 422, body: { name: "UNPROCESSABLE_ENTITY", debug_id: "dbg1", details: [{ issue: "AUTHORIZATION_EXPIRED" }] } }]);
    const err = await captureAuthorization("A1", "k").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 422, issue: "AUTHORIZATION_EXPIRED", debugId: "dbg1" });
  });

  it("turns an HTML error page into a readable PayPalError, not a JSON crash", async () => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.endsWith("/token")
        ? new Response(JSON.stringify(TOKEN.body), { status: 200 })
        : new Response("<html>502 Bad Gateway</html>", { status: 502 });
    }));
    const err = await captureAuthorization("A1", "k").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("Non JSON reply");
  });

  it("voids an authorisation", async () => {
    mockFetch([TOKEN, { status: 200, body: { id: "A1", status: "VOIDED" } }]);
    expect(await voidAuthorization("A1")).toEqual({ status: "VOIDED" });
    expect(calls[1]!.url).toContain("/v2/payments/authorizations/A1/void");
  });

  it("sends a PayPal-Request-Id on void, so a retried void is the same request at PayPal", async () => {
    mockFetch([TOKEN, { status: 200, body: { status: "VOIDED" } }]);
    await voidAuthorization("A1", "void-pay_1-A1");
    expect(header(calls[1]!, "PayPal-Request-Id")).toBe("void-pay_1-A1");
  });

  it("puts a unique invoice_id on every order and the agent key's custom_id when given", async () => {
    const body = { id: "O1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "A1", expiration_time: "x" }] } }] };
    mockFetch([TOKEN, { status: 201, body }]);
    await createAuthorizeOrder(req, { source: "card", customId: "spt-abcd:p1" });
    const unit = JSON.parse(String(calls[1]!.init.body)).purchase_units[0];
    expect(unit.invoice_id).toBe("spotter-p1");
    expect(unit.custom_id).toBe("spt-abcd:p1");
    mockFetch([{ status: 201, body }]);
    await createAuthorizeOrder(req, { source: "card" });
    expect(JSON.parse(String(calls[0]!.init.body)).purchase_units[0].custom_id).toBeUndefined();
  });

  it("cuts a custom_id to PayPal's 127 characters", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "O1", status: "CREATED" } }]);
    await createAuthorizeOrder(req, { source: "card", customId: "x".repeat(300) });
    expect(JSON.parse(String(calls[1]!.init.body)).purchase_units[0].custom_id).toHaveLength(127);
  });
});

describe("webhook signature check", () => {
  const headers = {
    authAlgo: "SHA256withRSA",
    certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    transmissionId: "t1",
    transmissionSig: "sig",
    transmissionTime: "2026-10-10T12:00:00Z",
  };
  // The exact bytes PayPal sent, with a float that JSON.parse then JSON.stringify would rewrite (1.10 -> 1.1).
  const raw = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":1.10}}}';

  it("accepts SUCCESS and sends PayPal the raw event with our webhook id", async () => {
    mockFetch([TOKEN, { status: 200, body: { verification_status: "SUCCESS" } }]);
    expect(await verifyWebhookSignature(headers, "WEBHOOK-1", raw)).toBe(true);
    expect(calls[1]!.url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    const sent = String(calls[1]!.init.body);
    expect(sent).toContain(`"webhook_event":${raw}`);
    expect(JSON.parse(sent)).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: headers.certUrl,
      transmission_id: "t1",
      transmission_sig: "sig",
      transmission_time: "2026-10-10T12:00:00Z",
      webhook_id: "WEBHOOK-1",
    });
  });

  it("rejects FAILURE or an answer without a status", async () => {
    mockFetch([TOKEN, { status: 200, body: { verification_status: "FAILURE" } }]);
    expect(await verifyWebhookSignature(headers, "WEBHOOK-1", raw)).toBe(false);
    mockFetch([{ status: 200, body: {} }]);
    expect(await verifyWebhookSignature(headers, "WEBHOOK-1", raw)).toBe(false);
  });

  it("throws when PayPal can't be asked, so the route can ask PayPal to retry", async () => {
    mockFetch([TOKEN, { status: 500, body: { name: "INTERNAL_SERVICE_ERROR" } }]);
    await expect(verifyWebhookSignature(headers, "WEBHOOK-1", raw)).rejects.toBeInstanceOf(PayPalError);
  });
});

describe("reauthorizeAuthorization", () => {
  it("posts to the reauthorize endpoint with an idempotency key and returns the NEW authorisation id", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "8AA831015G517922L", status: "CREATED", expiration_time: "2026-11-09T00:11:31Z" } }]);
    const r = await reauthorizeAuthorization("0VF52814937998046", "reauth-pay_1");
    expect(r).toEqual({ authorizationId: "8AA831015G517922L", expiresAt: "2026-11-09T00:11:31Z" });
    expect(calls[1]!.url).toBe("https://api-m.sandbox.paypal.com/v2/payments/authorizations/0VF52814937998046/reauthorize");
    expect(calls[1]!.init.method).toBe("POST");
    expect(header(calls[1]!, "PayPal-Request-Id")).toBe("reauth-pay_1");
    expect(calls[1]!.init.body).toBe("{}");
  });

  it("surfaces PayPal's issue, e.g. too soon inside the honor period", async () => {
    mockFetch([TOKEN, { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "REAUTHORIZATION_TOO_SOON" }] } }]);
    await expect(reauthorizeAuthorization("A1", "k")).rejects.toMatchObject({ status: 422, issue: "REAUTHORIZATION_TOO_SOON" });
  });
});

describe("an example sale for a family that sells", () => {
  it("is a CAPTURE order paid with the sandbox test card, and returns the order and capture ids", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "1AB23456CD789012E", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "2GG279541U471931P", status: "COMPLETED" }] } }] } }]);
    const r = await createExampleSale({ amount: 5000, currency: "GBP", item: "Example: trainers, size 9", ref: "sale_1" });
    expect(r).toEqual({ orderId: "1AB23456CD789012E", captureId: "2GG279541U471931P" });
    expect(calls[1]!.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "GBP", value: "50.00" });
    expect(body.payment_source.card.number).toBe("4111111111111111");
    expect(header(calls[1]!, "PayPal-Request-Id")).toBe("sale-sale_1");
  });

  it("throws when PayPal didn't complete the capture", async () => {
    mockFetch([TOKEN, { status: 201, body: { id: "1AB23456CD789012E", status: "PAYER_ACTION_REQUIRED", purchase_units: [{}] } }]);
    await expect(createExampleSale({ amount: 5000, currency: "GBP", item: "x", ref: "sale_2" })).rejects.toThrow(/capture/);
  });
});
