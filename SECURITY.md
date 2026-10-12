# Security

Spotter sits between people and their money, so security reports are welcome and taken seriously.

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repo (Security tab, "Report a vulnerability"). I aim to reply within 3 days and to fix anything serious within 7.

Useful to include: what you did, what happened, what you expected, and the page or endpoint.

## What's in scope

- The live demo at https://spotter-pay.vercel.app and the code in this repo
- Approving or capturing a payment without the spotter's PIN
- Reaching another household's payments, case files, evidence packs, agents or keys
- Webhook forgery (PayPal, Channel3, Telegram, Discord, email)
- Prompt injection or tool poisoning that changes a verdict or makes an agent act
- Using the MCP endpoints past an agent's allowance, its daily limit, after it's frozen, or with a switched off key
- Making the cloud browser (KERNEL) open a private or internal address

## Out of scope

- The PayPal sandbox itself, and the sponsors' own services
- Denial of service and volume testing (the demo has daily limits)
- Social engineering

## How Spotter is built to fail safe

- No AI and no agent can move money. There's no approve tool on either MCP server, and only the spotter's PIN approves a held payment.
- If the AI check can't run, the payment is held for a person, never waved through.
- Every webhook is verified before it's trusted, and an unset secret means the endpoint refuses. A PayPal webhook only records what PayPal says. It never captures or voids.
- Untrusted text (messages, emails, shop pages, tool descriptions) is cleaned and fenced before Claude reads it, and every warning must quote the message word for word.
- Agent keys are stored hashed and shown once, with 100 calls per key a day. A decoy key is issued with each one. If the decoy is ever used, the agent is frozen, every key is burned and its held payments are voided at PayPal.
- Every status change is a conditional update, and every PayPal money call that can be retried carries a `PayPal-Request-Id`.

The full threat model, including the gaps I know about, is in [docs/threat-model.md](docs/threat-model.md).

## Sandbox only, and where the secrets live

- The demo only talks to the PayPal sandbox. No real money moves, and no real card is ever used. What would need to change before real money is on [/real-money](https://spotter-pay.vercel.app/real-money).
- Secrets live in a git ignored `.env.local` on my machine and in the Vercel project's environment settings. No `.env` file with real values has ever been committed. `.env.example` lists the names, with no secret values.
- [/status](https://spotter-pay.vercel.app/status) and `/api/health` say what's working without showing any key, id or error text.

## Reviews so far

Every review writes its findings as tests that fail on the code it looked at, so a fix only counts once the test passes in CI.

| Date | Review | What it covered | Findings | Status |
|---|---|---|---|---|
| 11 Oct 2026 | Security ([docs/reviews/security-2026-10-11.md](docs/reviews/security-2026-10-11.md)) | Look at it safely, Channel3 price watch and webhook, MCP `watch_price`, Gran view, PayPal declined captures | 6 (3 medium, 3 low) plus 8 notes | All fixed, proof tests in `src/reviews/` pass |
| 11 Oct 2026 | Correctness ([docs/reviews/code-2026-10-11.md](docs/reviews/code-2026-10-11.md)) | Money paths, races, caps, leaked cloud browsers, silent failures | 10 proof tests, no blockers | All fixed, `*.review.test.ts` pass |
| 11 Oct 2026 | PayPal depth (money safety, idempotency, agent keys) | Void and capture failure paths, request ids, stale webhooks, the tripwire race, MCP rate limits | 11 risks | All fixed, see `src/core/money-safety.test.ts` |

## Known `npm audit` warnings

`npm audit --omit=dev` (checked 12 Oct 2026) reports 10: 5 high, 2 moderate, 3 low. Every one of them comes through `@paypal/agent-toolkit` 1.11.0, the official PayPal Agent Toolkit, which pins old versions of its dependencies:

- `@langchain/core` 0.3.6 and `langsmith` 0.1.68 (high: serialization injection, prototype pollution, redaction bypass) and the `uuid` 10 inside them (moderate). They're used by the toolkit's LangChain entry. Spotter only imports `@paypal/agent-toolkit/mcp`, which doesn't load LangChain.
- `ai` 4.3.19, `@ai-sdk/*` and `jsondiffpatch` 0.6.0 (high: XSS in its HTML formatter, prototype pollution; low and moderate in the AI SDK). They're used by the toolkit's AI SDK entry. Spotter doesn't import it, and never renders a JSON diff.
- `mathjs` 14.9.1 (high: unsafe property setters in its expression parser). The `mcp` entry does load mathjs, but only calls `round()` on numbers Spotter's guard already checked. No user text reaches a mathjs expression.

`npm audit fix --force` would "fix" this by downgrading the toolkit from 1.11.0 to 1.3.5, a breaking change to the version Spotter's guard and its tests are built on, so I haven't. I'll move to a fixed toolkit release when PayPal ships one, and recheck before every release.
