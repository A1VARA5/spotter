# Spotter against PayPal's own best practices

On 12 October I went through the checks in PayPal's AI Toolkit ([`commands/doctor.md`](https://github.com/paypal/AI-Toolkit/blob/main/commands/doctor.md) and the [`paypal-best-practices`](https://github.com/paypal/AI-Toolkit/tree/main/skills/paypal-best-practices) skill) by hand against Spotter's code. I read the files instead of installing the plugin, and the toolkit's live probes need PayPal's hosted sandbox MCP server, which has been down since about 6 October, so this is the static half only.

Two things failed. Both are fixed, with tests.

## Fixed

| Check | Before | Now |
| --- | --- | --- |
| 429 and 5xx retried with backoff, same idempotency key | A 429 or 500 failed the call and waited for the retry button or the daily job | One more try, then another: it waits as long as `Retry-After` says (up to 4 s), else 0.5 s then 1 s. Only for a GET or a POST that carries a `PayPal-Request-Id`, so a repeat can never be a second payment ([src/paypal/client.ts](../src/paypal/client.ts)) |
| Subscribe only to an ACTIVE plan | The plan was read for its price, never for its status | A plan PayPal doesn't call ACTIVE starts nothing ([src/core/subscriptions.ts](../src/core/subscriptions.ts)) |

The same day, after PayPal's workshop: a 401 now drops the cached token and asks once more with a fresh one.

## Passed

- Credentials only in env vars, server side. Nothing PayPal reaches the browser.
- OAuth client credentials with Basic auth, the token cached until 60 s before its `expires_in`.
- `PayPal-Request-Id` on every money POST: create, authorize, capture, void, reauthorize, the example sale, and the toolkit's `create_order` and `create_subscription`.
- Orders v2 and Payments v2 only. `intent: AUTHORIZE`, because nothing should leave before the spotter says yes.
- Orders made on the server, amounts added up by Spotter, with `currency_code` on every amount.
- A declined card is final: no hold, nothing paid, never retried with the same card.
- `debug_id` kept on the payment's timeline with the error.
- Webhooks: every event checked with `verify-webhook-signature` on the raw bytes, over HTTPS, deduped on the event id, an explicit list of 9 events (no wildcard), `PAYMENT.CAPTURE.COMPLETED` handled, and the notes to the spotter sent after the response.

## Different on purpose

- **Sandbox only, hardcoded.** The doctor wants a `PAYPAL_ENVIRONMENT` switch. Spotter is a sandbox demo, and a hardcoded sandbox URL means no setting can ever point it at real money.
- **A bad signature gets 401, not 200.** The doctor lists 200 as an option to stop replays. Spotter answers 401 for a forged request and 503 when PayPal can't be asked, so PayPal retries real events and the logs show the fakes.
- **No `BILLING.SUBSCRIPTION.*` webhooks.** Spotter doesn't sell subscriptions or grant access when one starts. An agent's subscription waits at `APPROVAL_PENDING`, and only the spotter can open PayPal's approval page.
- **No JS SDK.** People approve on PayPal's own approval page, so the JS SDK checks (v5 and v6, Venmo, Pay Later) don't apply.

Tests: [src/paypal/client.test.ts](../src/paypal/client.test.ts), [src/core/subscriptions.test.ts](../src/core/subscriptions.test.ts).
