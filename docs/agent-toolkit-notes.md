# PayPal Agent Toolkit: research and the Spotter guard (2026-10-10)

## What the toolkit really is

Read from the published package (`npm pack @paypal/agent-toolkit@1.11.0`, `mcp/index.js` and `README.md`) and the GitHub source layout (github.com/paypal/agent-toolkit, `typescript/src/shared/{tools,parameters,functions,api,client}.ts`, `typescript/src/modelcontextprotocol/{toolkit,mcpToolkit}.ts`).

- **Package:** `@paypal/agent-toolkit`. Versions: 1.9.0 (2026-08-10), 1.10.0 (2026-08-20), **1.11.0 (2026-09-01, latest)**. Pinned exactly at **1.11.0** (over 5 weeks old today).
- **Entry points:** `/mcp`, `/ai-sdk`, `/openai`, `/langchain`, `/bedrock`. Each wraps the same tool list (`shared/tools.ts`): `{ method, name, description, parameters (zod 3 object), actions }`.
  - `/mcp` exports `PayPalAgentToolkit` (an `McpServer` from `@modelcontextprotocol/sdk` 1.x, one `server.tool(method, description, parameters.shape, ...)` per allowed tool), `PayPalMCPToolkit` (`getTools()` returns the raw definitions, `getPaypalAPIService()` returns the executor) and `PayPalAPI` (`run(method, args)` returns a JSON string; errors come back as `{"error":{"message","type":"paypal_error"}}`, never thrown).
  - `/ai-sdk` exports `PayPalAgentToolkit` with `getTools()` for Vercel AI SDK v4 (`generateText({ tools })`), plus `PayPalWorkflows`.
- **Config:** `new X({ clientId, clientSecret, configuration: { actions: { orders: { create: true, get: true }, ... }, context: { sandbox: true } } })`. The MCP classes take `accessToken` instead. A tool is exposed if any of its `actions` flags is on (`isToolAllowed`).
- **Sandbox gotcha:** `context.sandbox` defaults to **false**, which means the live API (`PayPalAPI` and `PayPalClient` both pick `api-m.paypal.com` / `api.paypal.com` unless `sandbox: true`). Spotter always passes `sandbox: true`.
- **Hosted MCP server:** `https://mcp.paypal.com/sse` via `npx mcp-remote`, PayPal login in the browser (docs: set-up-a-remote-mcp-server). Local: `npx -y @paypal/mcp --tools=all` with `PAYPAL_ACCESS_TOKEN` and `PAYPAL_ENVIRONMENT=SANDBOX`.
- **Safety:** nothing. No spending limits, allowlists, confirmations or approvals anywhere in the code or docs. The best practices page only says "Define where an agent hands off to a human". Money tools (`pay_order`, `create_refund`, `accept_dispute_claim`, `send_invoice`) run straight away.
- **Order flow in the toolkit:** `create_order` builds an `intent: CAPTURE` order from flat items (`currencyCode` enum `["USD"]` only, `items[{name, quantity, description?, itemCost, taxPercent, itemTotal}]`, `discount`, `shippingCost`, `shippingAddress`, `notes`, `returnUrl`, `cancelUrl`); total = items + tax + shipping - discount. `pay_order({id})` POSTs `/v2/checkout/orders/{id}/capture`. `get_order({id})` GETs the order. Order ids must match `^[A-Z0-9]{17,32}$`.
- **Dependencies it pulls in:** `ai@4`, `openai@4.86.1`, `@langchain/core@0.3.6`, `@modelcontextprotocol/sdk@1`, `@paypal/paypal-server-sdk`, `mathjs`, `axios`, zod 3 (nested, the app stays on zod 4). `npm audit` now reports 15 issues (10 high) that all come through these (langchain, langsmith, mathjs, jsondiffpatch, ai provider utils). Spotter only calls `PayPalAPI.run("get_order")` and reads tool definitions, so none of the flagged code paths run, but it's worth knowing.

### All 48 tools in 1.11.0 (from `shared/tools.ts`)

Invoices: create_invoice, create_recurring_series, activate_recurring_series, get_recurring_series, cancel_recurring_series, delete_recurring_series, list_invoices, get_invoice, send_invoice, send_invoice_reminder, cancel_sent_invoice, delete_invoice, setup_invoice_auto_reminders, update_invoice_auto_reminder, search_invoicing, update_invoicing, cancel_invoice_auto_reminder, generate_invoice_qr_code, generate_invoice_number, record_payment_for_invoice, record_refund_for_invoice, create_conditional_rules_for_invoice.
Catalog: create_product, list_products, update_product, show_product_details.
Subscriptions: create_subscription_plan, list_subscription_plans, show_subscription_plan_details, create_subscription, show_subscription_details, cancel_subscription, update_subscription, update_plan.
Shipping: create_shipment_tracking, get_shipment_tracking, update_shipment_tracking.
Orders and payments: create_order, get_order, pay_order, create_refund, get_refund.
Disputes: list_disputes, get_dispute, accept_dispute_claim.
Reporting: list_transactions, get_merchant_insights (live only).

## Design: guard, pass through, or hide

Spotter's guard is a sibling MCP server at **`/api/toolkit/mcp`** with the toolkit's own tool names and argument shapes, the same bearer agent keys as `/api/mcp`, and the same per agent allowance. An agent built for PayPal's toolkit points at this URL instead of PayPal.

| Toolkit tool | Spotter | Why |
|---|---|---|
| `create_order` | **Guarded** | Becomes a Spotter payment request: spender = the agent, amount worked out by Spotter from the items (the agent's `itemTotal` is never trusted), item names for the price check, `notes` and optional `page_text` as untrusted context for the AI check. Then the normal lifecycle: rules, AI check, PayPal authorise hold, spotter approval. No named shop means a fresh "Unnamed shop #xxxx" payee, so it is always held. |
| `pay_order` | **Guarded** | Never captures. Returns Spotter's decision (paid, held for Sam, refused). Only the spotter's tap captures. |
| `get_order` | **Passed through** | Runs the toolkit's real `get_order` with Spotter's sandbox token, but only for an order this agent made (looked up by Spotter id or PayPal order id and `spender_id`). Spotter's status goes on top. |
| `create_refund`, `accept_dispute_claim`, `record_refund_for_invoice` | Hidden | Money moving, but Spotter's lifecycle only knows "this spender pays that payee from a held authorisation". Refunds and dispute settlements go the other way, so there is no honest Spotter path yet. |
| `create_invoice`, `send_invoice`, recurring series, `send_invoice_reminder`, `record_payment_for_invoice` | Hidden | Invoices ask other people for money in the household's name. That is a real risk (an agent spamming payment requests) but not a payment Spotter can hold. Paying a supplier's invoice is business mode (plan item 1) and would reuse `create_order`'s path. |
| `create_subscription`, `update_subscription`, plans | Hidden | Recurring charges need a "yes to every month" rule Spotter doesn't have. |
| `list_transactions`, `list_invoices`, `get_invoice`, `get_refund`, `list_disputes`, `get_dispute`, `search_invoicing` | Hidden | All families share Spotter's one sandbox merchant, and these list the whole merchant account. They can't be scoped to one family, so they stay hidden. |
| Catalog, shipping, `cancel_*`, `delete_*`, `generate_*`, `get_merchant_insights` | Hidden | Merchant admin, not something a family's agent needs. |

Differences from the official shapes, all backwards compatible: `currencyCode` also takes `GBP` (the official enum is USD only, and the agent's allowance currency must match or the currency rule blocks it); optional extras `payee`, `category`, `page_text`. The reply is JSON with `id` (Spotter's payment id in the toolkit's order id format), `status` (`COMPLETED`, `HELD_FOR_APPROVAL`, `BLOCKED`, `NEEDS_PROTECTED_PAYMENT`, `DENIED`, `FAILED`, `CHECKING`), `paypal_order_id` and `spotter.message` in plain words.

A test (`src/server/toolkit-mcp.test.ts`) loads the official 1.11.0 definitions and checks every Spotter tool exists there, accepts every official argument and requires nothing extra.

## Checked

- Sandbox, 2026-10-10: Spotter's `createAuthorizeOrder` made order 07E05588KE778433U, the toolkit's own `get_order` (via `src/paypal/toolkit.ts`) read it back (`intent AUTHORIZE`, 12.34 USD), then the hold was voided.
- The demo agent (`scripts/toolkit-agent-demo.mts`) gives Claude PayPal's official definitions and sends every call to the guard. Not run yet (paid).

## Sources

- Package: https://www.npmjs.com/package/@paypal/agent-toolkit (version times from `npm view @paypal/agent-toolkit time`)
- Source: https://github.com/paypal/agent-toolkit (typescript/src/shared/tools.ts, parameters.ts, functions.ts, api.ts, client.ts; typescript/src/modelcontextprotocol/toolkit.ts, mcpToolkit.ts)
- Docs: https://paypal.gitbook.com/agent-toolkit-and-mcp-server , https://paypal.gitbook.com/agent-toolkit-and-mcp-server/available-tools.md , https://paypal.gitbook.com/agent-toolkit-and-mcp-server/mcp-server/set-up-a-remote-mcp-server.md , https://paypal.gitbook.com/agent-toolkit-and-mcp-server/best-practices.md
