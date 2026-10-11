// Adds Spotter's newer events to the PayPal webhook that already exists for this site (PayPal never adds them by itself).
// npx tsx --env-file=.env.local scripts/update-paypal-webhook-events.mts [https://spotter-pay.vercel.app] [--dry-run]
//
// PayPal's PATCH /v1/notifications/webhooks/{id} only supports "replace" on /event_types (docs/paypal-notes.md), so
// the whole list is sent: everything the webhook already has, plus anything in EVENTS it is missing. Nothing is
// ever removed. Idempotent: when nothing is missing it says so and sends nothing. Sandbox only.
// Never prints secrets: no token, no client secret, only webhook ids, URLs and event names.
import { EVENTS } from "./paypal-webhook-events.mts";

const BASE = "https://api-m.sandbox.paypal.com";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const site = args.find((a) => !a.startsWith("--")) ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://spotter-pay.vercel.app";
const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox)");
if (!site.startsWith("https://")) throw new Error(`PayPal only calls https URLs, got ${site}`);
const url = `${site.replace(/\/$/, "")}/api/paypal/webhook`;

// PayPal error bodies carry a name, a message and a debug id, never credentials; still, only those fields are shown.
async function failure(what: string, res: Response): Promise<never> {
  const j = (await res.json().catch(() => ({}))) as { name?: string; message?: string; debug_id?: string; details?: Array<{ issue?: string }> };
  throw new Error(`${what} failed: ${res.status} ${j.name ?? ""} ${j.details?.[0]?.issue ?? ""} ${j.message ?? ""} debug_id=${j.debug_id ?? "none"}`.replace(/\s+/g, " "));
}

const tokenRes = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
  signal: AbortSignal.timeout(15_000),
});
if (!tokenRes.ok) await failure("PayPal token request", tokenRes);
const { access_token } = (await tokenRes.json()) as { access_token: string };
const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };

type Hook = { id: string; url: string; event_types: Array<{ name: string }> };
const listRes = await fetch(`${BASE}/v1/notifications/webhooks`, { headers, signal: AbortSignal.timeout(15_000) });
if (!listRes.ok) await failure("Listing webhooks", listRes);
const { webhooks = [] } = (await listRes.json()) as { webhooks?: Hook[] };
const hook = webhooks.find((w) => w.url === url);
if (!hook) {
  console.log(`No webhook for ${url} in this sandbox app (it has ${webhooks.length}). Create one with scripts/register-paypal-webhook.mts.`);
  process.exit(1);
}

const have = hook.event_types.map((t) => t.name);
if (have.includes("*")) {
  console.log(`Webhook ${hook.id} already gets every event ("*"). Nothing to do.`);
  process.exit(0);
}
const missing = EVENTS.filter((e) => !have.includes(e));
console.log(`Webhook ${hook.id} for ${url}`);
console.log(`  has:     ${have.join(", ") || "(none)"}`);
if (!missing.length) {
  console.log("  missing: nothing. Nothing to do.");
  process.exit(0);
}
console.log(`  adding:  ${missing.join(", ")}`);
const next = [...have, ...missing];
if (dryRun) {
  console.log("Dry run: nothing sent.");
  process.exit(0);
}

const patchRes = await fetch(`${BASE}/v1/notifications/webhooks/${encodeURIComponent(hook.id)}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify([{ op: "replace", path: "/event_types", value: next.map((name) => ({ name })) }]),
  signal: AbortSignal.timeout(15_000),
});
if (!patchRes.ok) await failure("Updating the webhook's events", patchRes);
const updated = (await patchRes.json().catch(() => ({}))) as Partial<Hook>;
const now = updated.event_types?.map((t) => t.name) ?? [];
const stillMissing = EVENTS.filter((e) => !now.includes(e));
console.log(stillMissing.length ? `PayPal answered, but still missing: ${stillMissing.join(", ")}` : `Done. Webhook ${hook.id} now gets ${now.length} events.`);
if (stillMissing.length) process.exit(1);
