# Security

Spotter sits between people and their money, so security reports are welcome and taken seriously.

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repo (Security tab, "Report a vulnerability"). I aim to reply within 3 days and to fix anything serious within 7.

Useful to include: what you did, what happened, what you expected, and the page or endpoint.

## What's in scope

- The live demo at https://spotter-pay.vercel.app and the code in this repo
- Approving or capturing a payment without the spotter's PIN
- Reaching another household's payments, case files, evidence or agents
- Webhook forgery (PayPal, Channel3, Telegram, Discord, email)
- Prompt injection that changes a verdict or makes an agent act
- Using the MCP endpoints past an agent's allowance or after it's frozen

## Out of scope

- The PayPal sandbox itself, and the sponsors' own services
- Denial of service and volume testing (the demo has daily limits)
- Social engineering

## How Spotter is built to fail safe

- No AI and no agent can move money. Only the spotter's PIN approves a held payment.
- Every webhook is verified before it's trusted, and an unset secret means the endpoint refuses.
- Untrusted text (messages, emails, shop pages) is cleaned and fenced before Claude reads it, and every warning must quote the message word for word.
- Agent keys are stored hashed and shown once. Making a new key switches the old one off.
