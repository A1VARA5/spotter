# Spotter

PayPal holds the money until someone you trust says yes. Gran forwards the text she isn't sure about, and if it looks like a scam, PayPal holds her £250 and you get asked. Your kid and your AI shopping agent work the same way.

Live: https://spotter-pay.vercel.app

Built for the PayPal AI Hackathon. Everything runs on the PayPal sandbox, so no real money moves.

## For judges

No sign up and no PayPal account needed.

1. Open https://spotter-pay.vercel.app and press **Try it on fake money**. You get your own private demo family (Gran, Leo and a shopping agent), deleted after 48 hours. The PIN is `2468`.
2. The dashboard opens on one payment already waiting for you: Gran's forwarded "Hi Mum" text, £250. The PayPal part is real, a sandbox authorisation made the moment your family was created. The scam check and case file on it were written earlier and say "Example, checked earlier" on the card. Approve it (type `2468`) and PayPal captures the money, or deny it and PayPal voids the hold. If the sandbox didn't answer, the dashboard says so and the family starts without it.
3. Go to **Try a payment** and send these. Each one is a live Claude check and a real sandbox hold, and they come out the same in any order:
   - Gran forwards a "Hi Mum" text: held for you, with the warning signs quoted.
   - Gran buys a tablet from a local listing: not sent, because Friends and Family has no buyer protection.
   - Agent wants £249 earbuds: held, with the real shop price next to it.
   - Agent lands on a booby trapped shop: stopped. The case file shows what a person sees next to the hidden line the agent read.
   - Leo is offered cheap game credit: stopped, gift cards can't be undone.
   - Agent buys Mum a birthday mug: goes straight through and gets paid.
4. Open **Waiting for you** and decide the held ones. Every approval asks for the PIN.
5. If a week's allowance ever runs low after lots of sends, **Start fresh** on the Try page clears it.

### Testing an AI agent through PayPal's toolkit

Open the shopping agent's page (People, Shopping agent). In the connect panel pick **PayPal's Agent Toolkit**, press **Set this agent's allowance in dollars** (the toolkit only makes USD orders), then **Make a key**. The panel gives a one line `claude mcp add` command for Claude Code and an `npx mcp-remote` config for Claude Desktop. Ask the agent to order something with PayPal: its `create_order` becomes a Spotter payment and anything over the ask me amount waits on your dashboard. **Set back to pounds** in the same panel undoes the switch. This week's spend is counted per currency.

### Sandbox notes

- The demo family needs nothing from you. Every payment is a real PayPal sandbox order with fake money.
- **Log in with PayPal** uses the PayPal sandbox, so your real PayPal login won't work there. To try it, make a sandbox personal account at developer.paypal.com (Testing tools, Sandbox accounts) and log in with that.
- To run your own copy, create a sandbox app at developer.paypal.com (Apps and Credentials, Sandbox) and put its client id and secret in `.env.local` (see Run it locally below).

### What's real and what's an example

- Real: every PayPal call (orders, authorise, capture, void, webhooks), the Claude check and the case agent on payments you send, Channel3 prices, the KERNEL page visit, Telegram and Discord.
- Example: the one hold your demo family starts with has a check and case file written earlier, labelled on the card. Network counts in the landing page mockups say "In this example". Watchtower's starting month for demo families is a sample, labelled Sample.
- Tests: 512 passing (`npx vitest run`).

## What it does

One person, the spotter, signs in with PayPal and adds the people they look out for, each with simple rules: a weekly limit, an amount above which they're asked, and things that are never allowed (gift cards, crypto, gambling).

Those people don't get accounts. Each connects once, then sends Spotter anything that asks them for money:

- Email: they forward it to spotter@homingbox.net. Spotter checks who really sent it (aligned DKIM, SPF or DMARC), reads the request and replies in the same thread. Pairing is one email with a `SPOT-` code.
- Telegram: they open a pairing link from their page and press Start, then forward anything to @spotter_scam_bot. Spotter answers in the same chat ("On hold, nothing has left your account") and tells them later what the spotter decided.
- Discord: they add the Spotter app to their own account, then right click any message, Apps, Check with Spotter. Only they see the answer. Handy for Leo, because game chats are where the gift card scams live.
- AI agents: each agent gets its own key and four MCP tools (find products, request a payment, check a payment, check its allowance). There is no approve tool. The agent can ask to pay, and that's all it can do.

The spotter gets the alert by email, Telegram or a Discord DM, and the Telegram and Discord ones have a one tap Deny. Approving needs the PIN on the dashboard, so nobody can say yes for you.

For every request Spotter runs the person's rules, then Claude reads the message as untrusted text and has to quote the exact words that worried it. Code throws out any warning it can't find in the message, and hidden text (invisible Unicode tags, fake delimiters) is decoded and flagged. For shopping, Channel3 compares the price with real retailers, so earbuds for £24.99 that cost £179 everywhere else show up as evidence.

Then PayPal:

- allowed: Spotter authorises and captures straight away
- needs you: Spotter authorises (the money is reserved, not taken) and you get an alert email; approve captures it, deny voids it
- Friends and Family, gift cards, crypto: never sent, because there's no way back if it's a scam

Every status change is a single conditional update in Postgres, so a double tap can't capture twice, and a capture cut off halfway is settled later by asking PayPal for the authorisation's real status.

## While the money waits

A held payment doesn't just sit there. The case agent (Claude with five read only tools) looks into it, usually before the spotter has opened the alert:

- has anyone in the family paid this payee before
- the Spotter network: did other Spotter families say no to this payee in the last 30 days. Families only share an HMAC of the payee, never names or messages, and your own family never counts towards your number
- where every link in the message really goes: redirects, look alike domains, borrowed brand names and domain age
- whether the same product is sold at a real shop, and the state of the PayPal hold
- when a link asks for card details or a login, it opens that one link in a throwaway KERNEL cloud browser and reports where it really ends up, what the page asks for, and a small screenshot, so nobody in the family has to click it

Every finding has to name the tool call it came from, or code drops it. The agent can't pay, approve or deny. If it found the same thing at a real shop, the spotter gets one button: deny this payment and buy it there instead (the safe swap). PayPal voids the risky hold and the new order goes through PayPal like any other.

The case file shows up on the held card, in the Telegram alert and in the Discord DM. A case costs about 5p in model calls, and there's a 45 second hard cap so a slow site can't keep a payment waiting.

## Watchtower

Watchtower is the family's dashboard, built on AG Studio. Every payment, hold and scam sign sits on one board, and you can ask it things in plain words. I asked "What did Leo spend on games this month?" and AG's agent team, running on Claude, got the right answer (£9.98) and built the widget for it. The assistant can only read and rearrange the board, it never sees the scam messages, and the watch alerts come from code, not the model.

The chat opens with our own agent, called Spotter. It's the family's lookout. It reads case files, watch alerts, the scam radar and what PayPal said about a payment, and it can check a price live against real shops through Channel3. It doesn't build anything itself. When the board needs a widget or a page, Spotter hands the job to AG Studio's own planning, page, widget and data agents with a short brief. There's a second agent of ours too, the weekly brief writer: ask for "this week's brief" and Spotter passes it over, the brief agent gathers the numbers and asks the page and widget agents for a page called "Week of" and the date. AG's own lead agent is still in the roster. Every agent runs on Claude through my own adapter, which swaps in for AG's model layer and keeps the key on the server.

```
Spotter (ours) ── brief (ours) ──┐
       │                         ├── planning, page, widget, data (AG Studio)
       └─────────────────────────┘
lead (AG Studio, kept)   all on Claude via our swapped in adapter
```

The fair price widget shows what the shopping agent paid against the cheapest real shop this month, using the Channel3 check Spotter stored when each payment was made. On the demo family it says the agent paid £8.50 more than it had to, and that Spotter caught a £24.99 pair of earbuds that real shops sell for about £169.

## PayPal's agent tools, with Spotter in the middle

PayPal ships an official Agent Toolkit (`@paypal/agent-toolkit`, I pinned 1.11.0) that lets an AI agent create orders, capture them, send invoices, refund and so on. It has no spending limit and no approval step. If the agent calls `pay_order`, the money goes.

So Spotter has a second MCP server at `/api/toolkit/mcp` that speaks the toolkit's language. Same tool names, same arguments, same agent keys as the main one. An agent written for PayPal's toolkit points at Spotter instead and doesn't need to change.

- `create_order` doesn't go to PayPal. It turns into a normal Spotter payment request: the agent's allowance, the AI check on its notes and the page it saw, a PayPal hold, then the spotter says yes or no. Spotter works out the total from the items itself, because the agent's own `itemTotal` could say anything.
- `pay_order` never captures. It tells the agent what Spotter decided, like "held, Sam has to approve $119.00".
- `get_order` runs the toolkit's real `get_order` against the sandbox, but only for orders that agent made.
- Everything else is hidden for now. Refunds, invoices and subscriptions don't fit a "hold it, then the spotter decides" payment yet, and the list tools would show every family's orders, because they all share one sandbox merchant.

The toolkit's `create_order` only takes USD, so the agent needs a USD allowance. If it doesn't name a shop (the official tool has no field for that), the order always waits for the spotter. The details and the full tool list are in `docs/agent-toolkit-notes.md`, and `scripts/toolkit-agent-demo.mts` is a Claude agent that gets PayPal's own tool definitions and talks to Spotter instead.

## Where to look in the code

| What | Where |
| --- | --- |
| The payment lifecycle (rules, check, hold, capture, void, reconcile) | `src/core/lifecycle.ts` |
| Rules and the decision | `src/core/rules.ts`, `src/core/decide.ts` |
| The AI check, grounding and hidden text | `src/ai/check.ts`, `src/core/grounding.ts`, `src/ai/sanitize.ts` |
| Reading a payment out of a forwarded email | `src/ai/extract.ts`, `src/email/inbound.ts` |
| Telegram and Discord (pairing, forwards, Check with Spotter, alerts with Deny) | `src/telegram/`, `src/discord/`, `src/app/api/telegram/route.ts`, `src/app/api/discord/route.ts` |
| The case agent, its tools and link checks | `src/agents/case.ts`, `src/agents/tools.ts`, `src/agents/links.ts`, `src/ui/CaseFile.tsx` |
| The Spotter network | `src/core/network.ts` |
| PayPal (orders, authorise, capture, void, Log in with PayPal) | `src/paypal/client.ts`, `src/paypal/identity.ts` |
| PayPal webhooks (verified, deduped, settle stuck payments, never move money) | `src/app/api/paypal/webhook/route.ts`, `src/paypal/webhook.ts` |
| Opening a suspicious link in a throwaway KERNEL cloud browser (read only, one per case) | `src/agents/kernel.ts`, `open_link` in `src/agents/tools.ts` |
| Real shop prices | `src/market/channel3.ts`, `src/core/market.ts` |
| MCP server for agents | `src/app/api/mcp/route.ts`, `src/server/agent.ts` |
| PayPal's Agent Toolkit with a spotter (guarded `create_order` and `pay_order`, scoped `get_order`) | `src/app/api/toolkit/mcp/route.ts`, `src/server/toolkit-mcp.ts`, `src/server/toolkit-guard.ts`, `src/paypal/toolkit.ts` |
| Households, sessions, PIN, pairing codes, agent keys | `src/core/households.ts`, `src/server/auth.ts`, `src/core/pairing.ts` |
| Activity table (AG Grid) | `src/app/ledger/Ledger.tsx` |
| Watchtower (AG Studio widgets, Claude adapter, alerts, sample month) | `src/app/watchtower/`, `src/watchtower/` |

## Run it locally

You need Node 22, a PayPal sandbox app (client id and secret) and an Anthropic API key.

```
npm install
cp .env.example .env.local   # fill in the keys
npx next dev -p 3417
npx vitest run                # 512 tests
```

Without `DATABASE_URL` it uses PGlite in `.data/`, so there's nothing else to set up. Channel3 and Agentboxd are optional; without them the price check and email channel switch off.

## What doesn't work yet

- Spotter can't read texts or chat apps by itself, and nothing should. People forward what asks them for money. It can't read screenshots yet: send one on Telegram and it asks for the words instead.
- Discord DM alerts to the spotter work in code but I haven't seen one land yet. Discord only lets an app DM you if you share a server with it or allow it in your settings.
- It can't stop someone paying directly in the PayPal app. For people it's a habit, like ringing a sensible friend. For AI agents it is enforced, because the agent only has Spotter's tools.
- In the sandbox, Spotter pays with a sandbox card. A live version would have Gran link her own PayPal once so Spotter can pay on her behalf after the check.
- The AI check can be wrong. When it can't run or isn't sure, the payment waits for a person instead of going through.

## Credits

- PayPal REST APIs and Log in with PayPal, sandbox
- Claude (Anthropic) for the scam check and for reading requests out of emails
- Channel3 for real retailer prices
- KERNEL for the throwaway cloud browser that opens suspicious links
- AG Grid Community for the Activity table, and AG Studio (trial licence) for Watchtower
- Agentboxd for the spotter@homingbox.net inbox and its webhook
- Neon Postgres and Vercel for hosting
- The email sender checks and webhook verification come from my earlier project, Red Flag (github.com/A1VARA5/redflag), reused and credited here
- Claude Code (Anthropic), used as a coding tool

## Licence

MIT, see `LICENSE`.
