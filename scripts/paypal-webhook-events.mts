// The PayPal webhook events Spotter's handler (src/paypal/webhook.ts) listens for. One list for both
// register-paypal-webhook.mts (new webhook) and update-paypal-webhook-events.mts (PATCH an existing one).
// Names checked against developer.paypal.com/api/rest/webhooks/event-names (docs/paypal-notes.md).
// VAULT.PAYMENT-TOKEN.DELETED is left out on purpose: Spotter saves nothing to PayPal's vault.
export const EVENTS = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "CHECKOUT.ORDER.APPROVED",
  "IDENTITY.AUTHORIZATION-CONSENT.REVOKED",
];
