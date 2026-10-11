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
