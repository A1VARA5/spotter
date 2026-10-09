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
