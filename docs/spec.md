# Spotter: product spec (v1, 2026-10-09)

A spotter for every payment. Spotter sits between whoever is paying and PayPal. Every payment passes three checks: the spender's rules, an AI check that must quote its evidence, and, when needed, a trusted human (the spotter) who approves or denies from their phone. The money is held by PayPal (authorised, not captured) until Spotter or the spotter says yes.

## Who

- **Spender**: whoever wants to pay. Three kinds, one engine:
  - an **AI agent** (Claude, ChatGPT or any MCP client) paying through Spotter's MCP tools instead of calling PayPal directly;
  - an **older relative** using a Telegram bot ("should I pay this?", forwards a payment request);
  - a **kid** with an allowance (stretch goal, same rules model).
- **Spotter**: the trusted person who gets the ping (owner for their own agent, grandkid for Gran, parent for kid).

## The core loop

1. A spender asks to pay: amount, currency, payee, what for, and the context it came from (agent's cart and the page it shopped on, or the message Gran received).
2. **Rules** (pure code): weekly allowance left, per payment "ask me above" threshold, blocked categories (gift cards, crypto, gambling), allowlisted / blocked payees, new payee flag.
3. **AI check** (Claude): reads the context as untrusted data and returns red flags, each with an exact quote from the context. Code drops any flag whose quote is not literally in the context (grounding). Flags include: pressure / urgency, impersonation, "pay Friends & Family", gift card or crypto request, prompt injection aimed at the agent ("ignore your budget"), price far off, brand new shop.
4. **Decision**: `allow`, `ask` (spotter must approve), `block`, or `protect` (the request asked for an unprotected method; Spotter offers a PayPal Goods & Services order instead). Evidence beats vibes: a hard rule or a grounded high severity flag can only push towards block/ask, never towards allow.
5. **Money**: Spotter creates a PayPal order with `intent: AUTHORIZE`. The payer approves it (sandbox). On `allow` or spotter approval, Spotter **captures** the authorisation; on deny or expiry it **voids** it. Every step is logged.
6. **Spotter ping**: Telegram message (and the web dashboard) with the amount, payee, plain English reason, the quoted evidence, and Approve / Deny buttons.
7. **The feed**: a live, plain English log of every request, decision, evidence and PayPal state.

## Surfaces

- **Web app** (Next.js on Vercel): landing page, dashboard (spenders, allowances, live feed, approvals with evidence), a demo shop with an honest store and a booby trapped store (hidden prompt injection), and a judge **demo mode** that runs each scenario end to end in the sandbox without Telegram.
- **MCP endpoint** (`/api/mcp`): tools `request_payment`, `payment_status`, `my_allowance` for agents.
- **Telegram bot**: Gran's chat (forward or paste a request, gets a calm answer) and the spotter's chat (approval buttons).

## Non goals for the hackathon

Real money, live PayPal, KYC, bank integrations, multi currency beyond GBP/USD, Discord (later), native apps.

## Quality bar

- Distinctive, polished UI (not a template). Accessible, phone first for the spotter.
- Money flows and rules covered by tests; grounding covered by tests; prompt injection test set.
- Webhooks verified (PayPal webhook signature, Telegram secret token).
- Secrets only in env vars; sandbox credentials documented for judges.

## Milestones (deadline Thu Nov 12, 12pm PT)

1. **Core** (Oct 10 to 14): rules engine, grounded AI check, decision, PayPal authorise / capture / void in sandbox, Postgres, web approvals, tests.
2. **Agent face** (Oct 15 to 20): MCP endpoint, demo shop with injection, a demo agent run.
3. **Gran face** (Oct 21 to 26): Telegram bot both sides, F&F to protected order conversion.
4. **Design and deploy** (Oct 27 to Nov 3): final UI pass, live on Vercel, judge demo mode, screenshots.
5. **Ship** (Nov 4 to 11): README with sandbox credentials, YouTube video, Devpost submission.
