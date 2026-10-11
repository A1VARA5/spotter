# Threat model

Spotter sits between people and their money and reads text written by scammers, so I wrote down who attacks it, how, and what stops them. Where something is still open, it says so. The short version for reporters is in [SECURITY.md](../SECURITY.md).

## What we protect

1. Money. Nothing is captured without the rules passing or the spotter's PIN, and nothing a stranger pushes is sent irreversibly.
2. The verdict. A scammer shouldn't be able to talk the AI into "looks fine".
3. Each family's data: payments, case files, evidence packs, agents and keys.
4. The budget. Every check costs a model call, and some cost KERNEL or Channel3 credits too.

## Who attacks

| Attacker | What they control | What they want |
| --- | --- | --- |
| A scammer messaging Gran | The message text, links, the shop page, its hidden text and agent tools | Gran pays, or the verdict says it's fine |
| A booby trapped shop | Page text people can't see, WebMCP tool descriptions | An AI agent pays more, buys more, or refunds someone |
| Someone who stole an agent's key | Calls to both MCP servers | Money out, or another family's data |
| Anyone on the internet | Requests to every public endpoint | Forged webhooks, free model calls, other families' data |
| A misbehaving or hijacked agent | Tool calls and their arguments | The same as the scammer, through the agent |

## Threats and what stops them

### Prompt injection

- Untrusted text (messages, emails, page text, tool descriptions) goes through `src/ai/sanitize.ts`: invisible Unicode tags are decoded, fake delimiters and fake `<email>` wrappers are stripped, and the text is fenced as data. A hidden trick becomes a flag on its own.
- The model has no tools and returns structured output. Each flag must quote the message, and `src/core/grounding.ts` drops any quote it can't find.
- Evidence can only make the decision stricter. Code's own findings (market price, changed bank details, cut up payments) join the flags without the model.
- The case agent's findings must name the tool call they came from, its shop names come only from tool results, and the market check reaches it as trusted facts it can't contradict.
- Watchtower's assistant never sees scam messages, its tools are read only, image and free text widgets are off, and the receipt is built from the AG Studio telemetry rather than the model's words.

### Tool poisoning

- KERNEL lists the tools a shop registers for AI agents (`listTools`, custom tools excluded) and never runs them. Descriptions written to steer an agent are flagged in the case file.
- A partial read never reports clean: unread or unreadable tools mark the check incomplete.

### A hijacked or leaky agent

- No approve tool exists on either MCP server.
- 35 seller tools are offered to a shopping agent as tripwires. Calling one freezes the agent, voids its held payments through the normal deny and alerts the spotter. The freeze is checked again before the hold, after it, before an automatic capture and in reconcile, so an order racing the tripwire can't slip through.
- A canary key (`SPOTTER_KEY_BACKUP`) is issued with every real key. Its use freezes the agent, burns all keys and voids held payments, and the caller gets a calm 401 that doesn't reveal the trap.
- Keys are 32 random bytes, stored as a SHA-256 hash, compared in constant time, shown once. Switch off now revokes without reissuing.
- Data is scoped to the key's family: `get_order` only for orders that agent made, selling reads only the family's own sales, refunds only to the family's own captures.

### Webhook forgery

- PayPal: raw body, 256 KB cap, five transmission headers required (401), the PayPal verify API on the exact bytes, no `PAYPAL_WEBHOOK_ID` means 503. Events are deduped and only record what PayPal says. A webhook never captures or voids.
- Telegram: the secret token header. Discord: the Ed25519 signature on the raw body. Email: the Agentboxd webhook secret, plus aligned DKIM, SPF or DMARC on the forwarded message. Channel3: the Svix signature, and its deliveries are hints only (a daily job polls).
- An unset secret means the endpoint refuses, never that it trusts.

### SSRF through link checks and cloud browser visits

- The link inspector follows redirects by hand, HEAD first, at most 5 hops, and checks every hop's host against localhost, `.local`, `.internal`, private, loopback, carrier and link local ranges. The connection itself goes through a guarded lookup, so a name that resolves differently the second time (DNS rebinding) can't slip between check and connect.
- The case agent's KERNEL visit only opens http or https links that are in the payment's own message, one per case.
- "Look at it safely" only opens the page already on the case file, checks its recorded final address, and walks every redirect hop again right before the browser starts.
- Open risk: KERNEL browsers run in the KERNEL network. I haven't confirmed that their egress blocks private and cloud metadata ranges (169.254.169.254 and friends). A page could navigate somewhere private with script after it loads. Spotter only ever shows what that browser loads as a picture or text, but it's an open question for KERNEL. Details in [kernel-notes.md](kernel-notes.md).

### Cost abuse

Daily caps on everything that costs money, checked before the call:

| What | Cap |
| --- | --- |
| MCP tool calls | 100 per key, 2,000 overall |
| Payment checks from the site | 150 a day (`SPOTTER_DAILY_LIMIT`) |
| Agent lab runs | 3 per family, 150 overall |
| Watchtower assistant | 60 turns per family, 600 a day |
| Look at it safely | 3 per family, 30 overall, 90 seconds each |
| Case agent | 5 turns, 6 tool calls, 45 seconds |

Channel3 searches, price watches, photo checks and messages per Telegram chat, Discord user and email sender have their own daily caps too. Searches are cached in Postgres so repeats cost nothing.

### Approve and Deny, or a timeout, landing together

- Every status change is a conditional update from the state it expects (`move()` in `src/core/lifecycle.ts`). Two taps, or a tap and the daily job, can't both win.
- Approving needs the PIN every time, and is refused while Spotter is still looking.
- Webhooks use the same conditional updates, a decline is final even if a late COMPLETED arrives, and a stale event is ignored with the reason written down.

### Unauthenticated access to a family's data

- Sessions are httpOnly HMAC signed cookies (`SESSION_SECRET`). Approve, deny and settings need the unlocked spotter session with the PIN. PIN guesses are locked out.
- KERNEL replay links are sealed with AES-256-GCM inside the case file and relayed by the server only to the household that owns the payment.

## What happens when things fail

| Failure | What Spotter does |
| --- | --- |
| The AI check errors, times out (20 s, one retry) or the key is out of credit | `ok: false`, and `decide()` holds the payment: "The AI check didn't run, so this needs your yes." The PayPal hold is still made |
| The case agent or KERNEL is slow | The 45 second cap ends the case. The payment still waits for a person |
| PayPal times out or answers 5xx on capture | The row stays `capturing`. `reconcileStuck` asks PayPal for the authorisation's real state after 5 minutes and finishes it |
| PayPal refuses a capture or void with a firm 4xx | Spotter reads the authorisation from PayPal before changing any label, so a live hold is never marked failed |
| A void doesn't get an answer | The row stays `voiding` and reconcile finishes it from the state PayPal reports |
| A retry of any money call | The same `PayPal-Request-Id` (`capture-<id>-<auth>`, `void-<id>-<auth>`, `reauth-<id>-<from>`, `refund-<id>`, `create-<id>`), so PayPal treats it as one request |
| A webhook handler throws | The event row is deleted so the PayPal retry is processed. The PayPal verify API being down gives 503, so PayPal retries |
| The server crashes after PayPal made the hold | The payment stays in front of the spotter, never silently dropped |

## Known gaps

- If PayPal creates an authorisation but its answer never reaches Spotter, the ids aren't saved, and that hold ends only when PayPal expires it (29 days).
- `captureFailed` uses an unconditional status write in one path, which could relabel a just voided row as failed. Small, and on the list.
- PayPal renewing a card funded hold on day 4 ("Ask again tomorrow") is unproven. The app only claims a renewal when PayPal returned one.
- KERNEL egress isolation, above.
- `npm audit` reports high issues in `@paypal/agent-toolkit`'s own dependencies. Spotter reads its tool definitions and calls a handful of methods, none of which touch the flagged code.
