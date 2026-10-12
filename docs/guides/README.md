# Guides

Four write ups from building Spotter, one per tool I leaned on hardest. Each one is from my own runs: the code it links is the code on the live site, the numbers come from logs and test rounds between 9 and 12 October 2026, and every row in its "What went wrong" table links to the commit that fixed it. Each one also says what it costs to run and what to check when it doesn't work. The exact numbers and their dates are in [docs/numbers.md](../numbers.md).

| Guide | For | What's in it |
| --- | --- | --- |
| [A custom AG Studio agent that lets the built in agents do the building](ag-studio-custom-agent.md) | AG Studio builders | A primary agent with `delegate_to`, `place_widget`, a receipt built from telemetry with Undo, a model per agent, the chart polish hook, the didn't finish state and the remount |
| [Price checks that change the decision, with Channel3](channel3-price-checks-that-change-decisions.md) | Channel3 developers | Price tracking and a shared live watch, the market check before `decide()`, four rules for an honest going rate, spot the difference, the Svix webhook |
| [What a person sees vs what an agent reads, with KERNEL](kernel-seen-vs-read.md) | Anyone letting an agent read web pages | Seen vs read in an isolated world, desktop vs UK phone, where card details go, zero clicks proof from telemetry, WebMCP listing, SSRF hops |
| [The PayPal Agent Toolkit with tripwires in it](paypal-agent-toolkit-tripwires.md) | Agent Toolkit users | All 47 tools per agent job, bait tools, the canary key, `custom_id` binding, held refunds and subscriptions, idempotency keys, the agent lab |

Every guide ends with a short path you can follow on https://spotter-pay.vercel.app with no account.
