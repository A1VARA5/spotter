// Task 1 spike: can we authorise headless in the PayPal sandbox, then capture or void later?
// Run: npx tsx scripts/paypal-spike.ts
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = "https://api-m.sandbox.paypal.com";
const id = process.env.PAYPAL_CLIENT_ID!;
const secret = process.env.PAYPAL_CLIENT_SECRET!;

async function token(): Promise<string> {
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`token ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function call(t: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, body: j };
}

const card = {
  card: {
    number: "4111111111111111",
    expiry: "2030-12",
    security_code: "123",
    name: "Spotter Test",
    billing_address: { address_line_1: "1 Test Street", admin_area_2: "London", postal_code: "SW1A 1AA", country_code: "GB" },
  },
};

function order(value: string, withCard: boolean) {
  return {
    intent: "AUTHORIZE",
    purchase_units: [{ amount: { currency_code: "GBP", value }, description: "Spotter spike" }],
    ...(withCard ? { payment_source: card } : {}),
  };
}

const t = await token();
console.log("token ok");

// A: card, headless
const a = await call(t, "POST", "/v2/checkout/orders", order("12.50", true));
console.log("A create", a.status, a.body.status, a.body.details?.[0]?.issue ?? "");
let authId = a.body.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
if (!authId && a.body.id && a.body.status === "APPROVED") {
  const au = await call(t, "POST", `/v2/checkout/orders/${a.body.id}/authorize`, {});
  console.log("A authorize", au.status, au.body.status, au.body.details?.[0]?.issue ?? "");
  authId = au.body.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
}
if (authId) {
  const cap = await call(t, "POST", `/v2/payments/authorizations/${authId}/capture`, {});
  console.log("A capture", cap.status, cap.body.status, cap.body.details?.[0]?.issue ?? "");
}

// B: card, then void
const b = await call(t, "POST", "/v2/checkout/orders", order("40.00", true));
const bAuth = b.body.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
console.log("B create", b.status, b.body.status, bAuth ? "auth " + bAuth.slice(0, 6) : "no auth");
if (bAuth) {
  const v = await call(t, "POST", `/v2/payments/authorizations/${bAuth}/void`, {});
  console.log("B void", v.status, v.status === 204 ? "VOIDED" : JSON.stringify(v.body).slice(0, 200));
  const g = await call(t, "GET", `/v2/payments/authorizations/${bAuth}`);
  console.log("B status after void", g.body.status);
}

// C: PayPal wallet with buyer approval link (the fallback)
const c = await call(t, "POST", "/v2/checkout/orders", order("9.99", false));
console.log("C create", c.status, c.body.status, "approve link:", c.body.links?.find((l: any) => l.rel === "approve")?.href);
