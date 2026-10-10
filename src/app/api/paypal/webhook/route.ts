// PayPal webhook: PayPal tells Spotter when money moves (holds created or voided, captures done, denied, refunded).
//
// Anyone on the internet can POST here, so until PayPal vouches for a request everything in it is untrusted:
// - Fails closed: no PAYPAL_WEBHOOK_ID means 503 for every call (logged once), never "accept unverified".
// - The raw body is read once and sent back to PayPal's verify-webhook-signature API byte for byte, with the five
//   PAYPAL-* transmission headers and our webhook id. Only verification_status SUCCESS gets in; anything else is
//   401 and a log line. If PayPal can't be asked we answer 503 so PayPal retries later.
// - We never fetch the cert_url ourselves (PayPal's verify API does), so the header can't make us call anywhere.
// - Idempotent: each PayPal event id is stored once (paypal_events), and only the first sight acts.
// - A webhook never moves money. It only records what PayPal says and settles stuck rows, through one conditional
//   UPDATE per payment, so it can't race an approve or deny tap. Notes to the spotter go out after the response.
import { getDeps } from "@/server/deps";
import { verifyWebhookSignature } from "@/paypal/client";
import { handleWebhookRequest } from "@/paypal/webhook";

export const maxDuration = 60;

export async function POST(req: Request) {
  return handleWebhookRequest(req, { webhookId: process.env.PAYPAL_WEBHOOK_ID, verify: verifyWebhookSignature, deps: getDeps });
}
