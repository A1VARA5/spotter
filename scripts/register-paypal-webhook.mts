// Points the PayPal sandbox app's webhook at Spotter and prints the webhook id for PAYPAL_WEBHOOK_ID. Run after deploying:
// npx tsx --env-file=.env.local scripts/register-paypal-webhook.mts [https://spotter-pay.vercel.app]
// Safe to run twice: if a webhook for this URL already exists, it prints that one instead of making another.
const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
const site = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://spotter-pay.vercel.app";
if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox)");
if (!site.startsWith("https://")) throw new Error(`PayPal only calls https URLs, got ${site}`);

const BASE = "https://api-m.sandbox.paypal.com";
const url = `${site.replace(/\/$/, "")}/api/paypal/webhook`;
const EVENTS = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "CHECKOUT.ORDER.APPROVED",
];

const tokenRes = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
if (!tokenRes.ok) throw new Error(`PayPal token request failed: ${tokenRes.status}`);
const { access_token } = (await tokenRes.json()) as { access_token: string };
const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };

type Hook = { id: string; url: string; event_types: Array<{ name: string }> };
const listRes = await fetch(`${BASE}/v1/notifications/webhooks`, { headers });
if (!listRes.ok) throw new Error(`Listing webhooks failed: ${listRes.status} ${(await listRes.text()).slice(0, 300)}`);
const { webhooks = [] } = (await listRes.json()) as { webhooks?: Hook[] };
console.log(`This sandbox app has ${webhooks.length} webhook(s):`);
for (const w of webhooks) console.log(`  ${w.id}  ${w.url}`);

const existing = webhooks.find((w) => w.url === url);
if (existing) {
  const missing = EVENTS.filter((e) => !existing.event_types.some((t) => t.name === e || t.name === "*"));
  if (missing.length) console.log(`Already registered, but missing: ${missing.join(", ")}. Add them in the developer dashboard.`);
  console.log(`\nPAYPAL_WEBHOOK_ID=${existing.id}`);
} else {
  const res = await fetch(`${BASE}/v1/notifications/webhooks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, event_types: EVENTS.map((name) => ({ name })) }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<Hook> & { message?: string };
  if (!res.ok || !body.id) throw new Error(`Creating the webhook failed: ${res.status} ${body.message ?? ""}`);
  console.log(`Created a webhook for ${url}`);
  console.log(`\nPAYPAL_WEBHOOK_ID=${body.id}`);
}
console.log("Put that in .env.local and in Vercel (production), then redeploy.");
