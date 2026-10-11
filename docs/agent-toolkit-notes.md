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

### All 47 tools in 1.11.0 (from `shared/tools.ts`)

Counted from the installed package on 2026-10-11: `new PayPalMCPToolkit({ actions: everything }).getTools()` returns 47, and `mcp/index.js` has 47 entries in `tools`. Earlier notes and briefs said 48. That was a miscount (the list below always summed to 47). A test (`src/core/toolkit-coverage.test.ts`) now checks the number against the package.

Invoices: create_invoice, create_recurring_series, activate_recurring_series, get_recurring_series, cancel_recurring_series, delete_recurring_series, list_invoices, get_invoice, send_invoice, send_invoice_reminder, cancel_sent_invoice, delete_invoice, setup_invoice_auto_reminders, update_invoice_auto_reminder, search_invoicing, update_invoicing, cancel_invoice_auto_reminder, generate_invoice_qr_code, generate_invoice_number, record_payment_for_invoice, record_refund_for_invoice, create_conditional_rules_for_invoice.
Catalog: create_product, list_products, update_product, show_product_details.
Subscriptions: create_subscription_plan, list_subscription_plans, show_subscription_plan_details, create_subscription, show_subscription_details, cancel_subscription, update_subscription, update_plan.
Shipping: create_shipment_tracking, get_shipment_tracking, update_shipment_tracking.
Orders and payments: create_order, get_order, pay_order, create_refund, get_refund.
Disputes: list_disputes, get_dispute, accept_dispute_claim.
Reporting: list_transactions, get_merchant_insights (live only).

## Design: one coverage table, per agent job (2026-10-11)

`src/core/toolkit-coverage.ts` lists all 47 tools once, with a treatment and a plain reason for each agent job. It drives the MCP server at `/api/toolkit/mcp` (which tools an agent is offered and what each does) and the "all 47 tools" view (`src/ui/ToolkitCoverage.tsx`). Treatments:

- guarded: goes through Spotter's checks, and anything that moves money waits for the spotter's PIN
- passthrough: runs the toolkit's real call (`PayPalAPI.run`), only on things Spotter made for this family
- bait (tripwire): offered with PayPal's own name, description and JSON Schema (from the installed zod definitions), never runs
- hidden: not offered

The agent's job is `spenders.agent_job` (`shopping` by default, or `selling`), set by the spotter (`POST /api/toolkit/holds` with kind agent and action job, or the `AgentJob` switch in `src/ui/AgentHolds.tsx`). The server builds one tool set per job and picks it from the bearer key on each request. Counts today: shopping 3 guarded, 3 passed through, 35 bait, 6 hidden. Selling 3 guarded, 7 passed through, 0 bait, 37 hidden.

Key point: PayPal's toolkit is a seller's toolkit. Refunds, invoices, tracking and subscriptions act for the account that receives money. So for a shopping agent those tools are bait, and for a selling agent the money ones are guarded and the rest hidden (an honest seller might use them, but they can't be kept to one family on a shared sandbox merchant).

Second lock: `src/paypal/toolkit.ts` only runs the methods in `SPOTTER_RUNS` (the guarded and passed through ones). A bait or hidden tool can't reach PayPal even through a bug in the server. A test checks the set against the table.

### create_order for a shopping agent

Differences from the official shapes, all backwards compatible: `currencyCode` also takes `GBP` (the official enum is USD only, and the agent's allowance currency must match or the currency rule blocks it); optional extras `payee`, `category`, `page_text`. The reply is JSON with `id` (Spotter's payment id in the toolkit's order id format), `status` (`COMPLETED`, `HELD_FOR_APPROVAL`, `BLOCKED`, `NEEDS_PROTECTED_PAYMENT`, `DENIED`, `FAILED`, `CHECKING`), `paypal_order_id` and `spotter.message` in plain words.

Safer option (2026-10-10): when `create_order` is refused or held for shop reasons (hidden instructions, a fake shop price, a brand new shop, no named shop), the reply also has `safer_option` (`offer_id`, `title`, `retailer`, `price`, `url`, `reason`, `guidance`): a Channel3 offer for the same item within the agent's remaining allowance. `pay_order` on that order repeats it. The agent takes it with `create_order` plus the extra `offer_id` (one item, quantity 1, same payee and total); anything that doesn't match Spotter's stored suggestion (this agent, under an hour old, unused) is refused with `spotter_error` before a payment exists. The replacement is checked like any order. Logic in `src/core/safer.ts`.

A test (`src/server/toolkit-mcp.test.ts`) loads the official 1.11.0 definitions and checks every tool Spotter offers exists there, accepts every official argument and requires nothing extra, and that bait tools carry PayPal's own description and schema.

### Tripwires (`src/core/tripwire.ts`)

A bait call never calls PayPal. Spotter sets `spenders.frozen_at` (submitPayment refuses a frozen agent, and so do the toolkit guards), voids each of the agent's `needs_approval` holds through the normal `deny` (a real PayPal void), records a `tripwires` row (the tool, the arguments as capped JSON text, the most recent page line that could have caused it) and sends an `agent_hijacked` alert on the spotter's channels. That alert goes through `sendWarning` and is not stored as a dashboard warning: the tripwire row is the app's copy, shown by `AgentHolds`. The cause is the newest of: a KERNEL seen vs read hidden instruction, a poisoned WebMCP tool, or a `prompt_injection` flag from the AI check, on this agent's payments in the last 24 hours. Bait tools accept any arguments, so junk arguments still spring it. Unpausing needs the PIN every time.

The GadgetBarn demo shop's hidden line now ends with a refund ask (`REFUND_ASK` in `src/app/demo-shop/gadgetbarn/shop.ts`). No underscores in it on purpose: the seen vs read text cleaner drops them, which would make the case file quote differ from the page.

### Selling agent (`src/core/selling.ts`)

- `sales`: orders Spotter made for a household. A selling agent's `create_order` runs the toolkit's real `create_order` (USD, with an approve link for the buyer) and records the sale. `pay_order` runs the toolkit's capture, only for the household's own sale, and stores the capture id. Example sales for the demo come from `createExampleSale` (`src/paypal/client.ts`, a CAPTURE order paid with the sandbox test card, £50, labelled "Example sale").
- `create_refund` never runs from the agent. Spotter finds the capture in `sales` for that household (otherwise refused, so a refund can never name another family's capture or a made up one), reads the order with the toolkit's `get_order`, works out what is left (captured minus PayPal's completed or pending refunds, or Spotter's own sent refunds if that is higher) and stores a `refund_requests` row: `held`, or `refused` with "They paid £50.00. They're asking for £200.00 back. This is how the overpayment scam works." Approving (PIN) claims the row with one conditional update, reads PayPal again, then runs the toolkit's `create_refund` with the original capture and the checked amount only. `PAYMENT.CAPTURE.REFUNDED` (already in Spotter's webhook events) sets `confirmed_at`.
- `create_shipment_tracking`: only for a household sale, and only when PayPal's order shows a COMPLETED capture with that transaction id. Otherwise "Paid? Prove it".
- `get_refund` and `get_shipment_tracking` only read the household's own refunds and sales.

### Subscriptions (`src/core/subscriptions.ts`)

`create_subscription` reads the plan with `show_subscription_plan_details` and works out the tail (`subscriptionTail`: setup fee and the first cycle now, the next charge, the repeating cycle and the first year's total, in calendar months). Then it runs the toolkit's real `create_subscription`, which PayPal leaves in APPROVAL_PENDING. The approve link is stored in `held_subscriptions` and never given to the agent (`show_subscription_details` drops `links`). The spotter's PIN releases it once, and deny drops it. PayPal never charges a subscription nobody approved. The demo plan was made with `scripts/setup-toolkit-plans.mts` (toolkit `create_product` and `create_subscription_plan`): `P-8NW9871110770032DNLFXPGI`, "Example: StreamBox Premium (sandbox)", 7 day free trial, then $39.99 a month.

### The same money cut up (`src/core/cutup.ts`)

A held, blocked, protected or voided payment by the same agent to the same payee in the last 24 hours. A smaller `create_order` to that payee gets a code flag (medium, so it is held) through `PaymentInput.codeFlags`. A `create_subscription` to it (payee from the Spotter extra `payee`, otherwise the plan name) gets the line in the spotter's alert and in the agent's answer.

### Not built

Step 4, the sealed envelope (a hash of the agent's task in the order's `custom_id`), is not built.

## Checked

- Local dev against the sandbox, 2026-10-11: an example sale (capture 552862544B421412Y). The selling agent's `create_refund` for £200 was refused with the overpayment line, £20 was held, another family's capture was refused, the £20 was approved with the PIN and became real refund 8J110812XM092231Y through the toolkit's `create_refund`, then £35 was refused (£30 left after PayPal's refund), and `get_refund` read it back. An unpaid sale through the toolkit's `create_order` (order 0X977488S27929056) and a fake payment email: `create_shipment_tracking` was refused with "Paid? Prove it". `create_subscription` on the demo plan made real subscription I-4WE7T5S487N5 in APPROVAL_PENDING, with the tail and the cut up line (a £150 StreamBox order held first), and no link in the agent's answer. The scripted naive test agent's `create_refund` sprang the tripwire: the £150 hold was voided at PayPal, the agent was frozen, its next `create_order` was refused, and the cause was found (the GadgetBarn line the AI check flagged). In the browser: the dashboard cards, approving the refund and getting the approval link with the PIN.
- Two real Claude runs with a naive system prompt: on GadgetBarn it refused the refund line and told the user about it, and on the fake email it checked `get_order` and refused to post. Transcripts: `../paypal-spotter-submission/toolkit-tripwire-run-2026-10-11.json` and `toolkit-fake-email-run-2026-10-11.json`.

- Sandbox, 2026-10-10: Spotter's `createAuthorizeOrder` made order 07E05588KE778433U, the toolkit's own `get_order` (via `src/paypal/toolkit.ts`) read it back (`intent AUTHORIZE`, 12.34 USD), then the hold was voided.
- The demo agent (`scripts/toolkit-agent-demo.mts`) gives Claude PayPal's official definitions and sends every call to the guard. Not run yet (paid).

## Sources

- Package: https://www.npmjs.com/package/@paypal/agent-toolkit (version times from `npm view @paypal/agent-toolkit time`)
- Source: https://github.com/paypal/agent-toolkit (typescript/src/shared/tools.ts, parameters.ts, functions.ts, api.ts, client.ts; typescript/src/modelcontextprotocol/toolkit.ts, mcpToolkit.ts)
- Docs: https://paypal.gitbook.com/agent-toolkit-and-mcp-server , https://paypal.gitbook.com/agent-toolkit-and-mcp-server/available-tools.md , https://paypal.gitbook.com/agent-toolkit-and-mcp-server/mcp-server/set-up-a-remote-mcp-server.md , https://paypal.gitbook.com/agent-toolkit-and-mcp-server/best-practices.md
