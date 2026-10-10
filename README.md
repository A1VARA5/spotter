# Spotter

A second look before the money goes. Spotter sits between PayPal and the people you look out for (your gran, your kid, your AI shopping agent). When a payment looks wrong, PayPal holds the money and you get asked.

Live: https://spotter-pay.vercel.app

Built for the PayPal AI Hackathon. Everything runs on the PayPal sandbox, so no real money moves.

## Try it in 60 seconds

1. Open https://spotter-pay.vercel.app and press **Try the demo family**. You get your own family (Gran, Leo and a shopping agent), nobody else sees it, and it's deleted after 48 hours. The PIN is `2468`.
2. Go to **Try a payment** and send a few. The forwarded "Hi Mum" WhatsApp gets held for you, the Marketplace iPad seller asking for Friends and Family gets refused, the booby trapped shop gets stopped, and the birthday mug just goes through.
3. Open **Waiting for you** and approve or deny. Approve and PayPal captures the money. Deny and PayPal releases it.

To set up your own household instead, press **Log in with PayPal** and use a PayPal sandbox personal account (sandbox only, your real PayPal won't work there).

## What it does

One person, the spotter, signs in with PayPal and adds the people they look out for, each with simple rules: a weekly limit, an amount above which they're asked, and things that are never allowed (gift cards, crypto, gambling).

Those people don't get accounts. Each connects once, then sends Spotter anything that asks them for money:

- Email: they forward it to spotter@homingbox.net. Spotter checks who really sent it (aligned DKIM, SPF or DMARC), reads the request and replies in the same thread. Pairing is one email with a `SPOT-` code.
- AI agents: each agent gets its own key and four MCP tools (find products, request a payment, check a payment, check its allowance). There is no approve tool. The agent can ask to pay, and that's all it can do.
- Telegram and Discord are designed and shown on the site, but not built yet. They're next.

For every request Spotter runs the person's rules, then Claude reads the message as untrusted text and has to quote the exact words that worried it. Code throws out any warning it can't find in the message, and hidden text (invisible Unicode tags, fake delimiters) is decoded and flagged. For shopping, Channel3 compares the price with real retailers, so "AirPods Pro for £24.99" or "£249 when Currys sells it for £179" shows up as evidence.

Then PayPal:

- allowed: Spotter authorises and captures straight away
- needs you: Spotter authorises (the money is reserved, not taken) and you get an alert email; approve captures it, deny voids it
- Friends and Family, gift cards, crypto: never sent, because there's no way back if it's a scam

Every status change is a single conditional update in Postgres, so a double tap can't capture twice, and a capture cut off halfway is settled later by asking PayPal for the authorisation's real status.

## Watchtower

Watchtower is the family's dashboard, built on AG Studio. Every payment, hold and scam sign sits on one board, and you can just ask it things. "What did Leo spend on games this month?" goes to AG's agent team running on Claude, which queries the data and adds the widget itself. I tried exactly that question and got the right answer (two Roblox payments, £9.98) plus a new widget.

Three widgets are Spotter's own: money kept, the hold track (click a stop and the whole board filters to it) and watch alerts. The alerts come from code, not the model: a run of holds for one person in a day, the same payee going after two people, a payment left waiting, a new kind of scam this week.

The assistant can only read and rearrange the board. It never sees the scam messages, only names, amounts and Spotter's findings, and image and text widgets are switched off so a scammer's payee name can't become a link on the family's dashboard. Each family gets 60 assistant turns a day. Demo families get a sample month, marked Sample, so the board isn't empty on day one.

## Where to look in the code

| What | Where |
| --- | --- |
| The payment lifecycle (rules, check, hold, capture, void, reconcile) | `src/core/lifecycle.ts` |
| Rules and the decision | `src/core/rules.ts`, `src/core/decide.ts` |
| The AI check, grounding and hidden text | `src/ai/check.ts`, `src/core/grounding.ts`, `src/ai/sanitize.ts` |
| Reading a payment out of a forwarded email | `src/ai/extract.ts`, `src/email/inbound.ts` |
| PayPal (orders, authorise, capture, void, Log in with PayPal) | `src/paypal/client.ts`, `src/paypal/identity.ts` |
| PayPal webhooks (verified, deduped, settle stuck payments, never move money) | `src/app/api/paypal/webhook/route.ts`, `src/paypal/webhook.ts` |
| Opening a suspicious link in a throwaway KERNEL cloud browser (read only, one per case) | `src/agents/kernel.ts`, `open_link` in `src/agents/tools.ts` |
| Real shop prices | `src/market/channel3.ts`, `src/core/market.ts` |
| MCP server for agents | `src/app/api/mcp/route.ts`, `src/server/agent.ts` |
| Households, sessions, PIN, pairing codes, agent keys | `src/core/households.ts`, `src/server/auth.ts`, `src/core/pairing.ts` |
| Activity table (AG Grid) | `src/app/ledger/Ledger.tsx` |
| Watchtower (AG Studio widgets, Claude adapter, alerts, sample month) | `src/app/watchtower/`, `src/watchtower/` |

## Run it locally

You need Node 22, a PayPal sandbox app (client id and secret) and an Anthropic API key.

```
npm install
cp .env.example .env.local   # fill in the keys
npx next dev -p 3417
npm test                      # 277 tests
```

Without `DATABASE_URL` it uses PGlite in `.data/`, so there's nothing else to set up. Channel3 and Agentboxd are optional; without them the price check and email channel switch off.

## What doesn't work yet

- Telegram and Discord. The flows are designed and on the site; the bots aren't built.
- Spotter can't read texts or WhatsApp by itself, and nothing should. People forward or screenshot what asks them for money. Screenshot reading isn't built yet either.
- It can't stop someone paying directly in the PayPal app. For people it's a habit, like ringing a sensible friend. For AI agents it is enforced, because the agent only has Spotter's tools.
- In the sandbox, Spotter pays with a sandbox card. A live version would have Gran link her own PayPal once so Spotter can pay on her behalf after the check.
- The AI check can be wrong. When it can't run or isn't sure, the payment waits for a person instead of going through.

## Credits

- PayPal REST APIs and Log in with PayPal, sandbox
- Claude (Anthropic) for the scam check and for reading requests out of emails
- Channel3 for real retailer prices
- AG Grid Community for the Activity table, and AG Studio (trial licence) for Watchtower
- Agentboxd for the spotter@homingbox.net inbox and its webhook
- Neon Postgres and Vercel for hosting
- The email sender checks and webhook verification come from my earlier project, Red Flag (github.com/A1VARA5/redflag), reused and credited here
- Claude Code (Anthropic), used as a coding tool

## Licence

MIT, see `LICENSE`.
