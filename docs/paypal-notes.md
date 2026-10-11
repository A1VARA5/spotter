# PayPal sandbox notes (spike 2026-10-09, `scripts/paypal-spike.ts`)

Account: sandbox, region GB, Default Application. Base URL `https://api-m.sandbox.paypal.com`.

## Answer: headless authorise works with a card payment source

- `POST /v2/checkout/orders` with `intent: "AUTHORIZE"` and `payment_source.card` (test Visa `4111111111111111`, expiry `2030-12`, CVV `123`, GB billing address) returns **201, order status `COMPLETED`**, with the authorisation already created at `purchase_units[0].payments.authorizations[0].id`. No separate `/authorize` call needed, no human click.
- `POST /v2/payments/authorizations/{id}/capture` returns **201 `COMPLETED`**.
- `POST /v2/payments/authorizations/{id}/void` returns **200 `VOIDED`** (with `Prefer: return=representation`). `GET` afterwards also shows `VOIDED`.
- The authorisation `expiration_time` was 29 days after creation. Honor period is shorter (3 days); captures after that may need reauthorise. Spotter's approval window should be well under 3 days.
- Send `PayPal-Request-Id` (idempotency) on create and capture.

So the **agent face** uses an authorise with the owner's saved card (sandbox test card for the demo; in a real product this would be a vaulted payment method).

## Approval link flow (for people, e.g. Gran)

- Same create call without `payment_source` returns **201 `CREATED`** and an `approve` link (`https://www.sandbox.paypal.com/checkoutnow?token=...`). The buyer logs in with the sandbox personal account, then the server calls `POST /v2/checkout/orders/{id}/authorize`.

## Sandbox accounts

- Business (seller): in `.env.local` (`PAYPAL_SANDBOX_BUSINESS_EMAIL` / `_PASSWORD`).
- Personal (buyer): `sb-nm5oy53273570@personal.example.com`, password in the developer dashboard (Testing tools > Sandbox accounts).

## Reauthorize and the honor period (read 2026-10-11 from developer.paypal.com/api/payments/v2/schema.json, the authoritative Payments v2 spec)

- `POST /v2/payments/authorizations/{authorization_id}/reauthorize`. Headers: `PayPal-Request-Id` (idempotency), `Prefer` (`return=minimal` default, `return=representation` for the full body). Body: only `amount` is supported, and it is optional (the spec has an "empty request" example `{}`).
- Spec text, quoted: "To ensure that funds are still available, reauthorize a payment after its initial three-day honor period expires." "If 30 days have transpired since the date of the original authorization, you must create an authorized payment instead of reauthorizing the original authorized payment." "A reauthorized payment itself has a new honor period of three days."
- The spec contradicts itself on how many times ("you can issue multiple re-authorizations" in the operation text, "You can reauthorize an authorized payment once" in `reauthorize_request`). The error list settles it: `REAUTHORIZATION_NOT_SUPPORTED`: "A reauthorize cannot be attempted on an authorization_id that is the result of a prior reauthorization". The live sandbox said "only allowed once" (below). Spotter treats it as **once per hold**.
- Responses: 201 (or 200 for an idempotent repeat) with an `authorization` body: `id` (a **new** authorization id: the spec's example path id `0VF52814937998046` returns `id: 8AA831015G517922L`), `status` (`CREATED`), `expiration_time` (RFC 3339, only with `return=representation`), links for capture, void and reauthorize on the new id. So after a reauthorize, capture and void must use the new id.
- 422 issues in the spec: `REAUTHORIZATION_TOO_SOON` ("Re-authorization is not allowed within the three-day honor period"), `AUTH_CURRENCY_MISMATCH`, `REAUTHORIZATION_NOT_SUPPORTED`, `REAUTHORIZATION_NOT_SUPPORTED_FOR_PAYMENT_SOURCE` ("Reauthorization is not supported for the payment source"), `REAUTHORIZATION_DECLINED_BY_PROCESSOR`, `AUTHORIZATION_VOIDED` ("You cannot capture or reauthorize a voided authorization"), `AUTHORIZATION_EXPIRED`.
- Authorization `status` enum: `CREATED`, `CAPTURED`, `DENIED`, `PARTIALLY_CAPTURED`, `VOIDED`, `PENDING`. `expiration_time`: "The date and time when the authorized payment expires".
- Live sandbox probe 2026-10-11 (card hold of £1.23, voided straight after): `POST .../reauthorize` with `{}` on a minutes old card authorisation answered **422 `REAUTHORIZATION_TOO_SOON`**: "A reauthorization is only allowed once from Day 4 to Day 29 since the date of the original authorization." The hold's `expiration_time` was 29 days after it was made (made 2026-10-11 00:11 UTC, expires 2026-11-09T00:11:31Z). Whether a day 4 reauthorize of a *card* hold succeeds can't be proven inside a day; Spotter handles `REAUTHORIZATION_NOT_SUPPORTED_FOR_PAYMENT_SOURCE` by saying so on the case file and keeping the hold until it ends.
- PayPal's webhook list says `PAYMENT.AUTHORIZATION.VOIDED` fires "either due to authorization reaching its 30 day validity period or authorization was manually voided". So an unanswered hold ends on its own and the money goes back. Spotter never captures without the spotter.

## Webhook events for "Someone switched Spotter off" (read 2026-10-11 from developer.paypal.com/api/rest/webhooks/event-names)

- Log in with PayPal: `IDENTITY.AUTHORIZATION-CONSENT.REVOKED`, trigger "A user's consent token is revoked.", related method "Not applicable". PayPal documents **no resource fields** for it. The only real reader found on GitHub (antiwork/gumroad, `paypal_merchant_account_manager.rb`) takes `resource.merchant_id || resource.payer_id`. Spotter's households hold the OpenID `user_id` from `/v1/identity/openidconnect/userinfo`, so the handler matches any of `resource.user_id`, `resource.payer_id`, `resource.merchant_id`, `resource.sub`, also comparing the last path segment (PayPal's OpenID `user_id` can be a URL ending in the id). An event that matches no household is only recorded. Not yet seen live: check the first real one in `paypal_events`.
- Vault: `VAULT.PAYMENT-TOKEN.DELETED` "A payment token is deleted. The payer's payment method is no longer saved to the PayPal vault." Spotter saves nothing to the vault (agents use the sandbox test card inline, people approve each order), so it does **not** subscribe to this.
- Payments v2 also lists `PAYMENT.CAPTURE.DECLINED` ("A payment capture is declined").
- Update webhook: `PATCH /v1/notifications/webhooks/{webhook_id}` (from developer.paypal.com/api/webhooks/v1/schema.json): "Supports only the `replace` operation. Pass a `json_patch` object with `replace` operation and `path`, which is `/url` for a URL or `/event_types` for events. The `value` is either the URL or a list of events." Adding events means replacing the whole list: `[{"op":"replace","path":"/event_types","value":[{"name":"..."}]}]`. `scripts/update-paypal-webhook-events.mts` does that.
