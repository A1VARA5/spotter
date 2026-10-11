# Contributing

Spotter is a hackathon project (PayPal AI Hackathon 2026), so the code moves fast. Issues and ideas are welcome.

## Run it locally

```
npm ci
cp .env.example .env.local   # add your own PayPal sandbox and Anthropic keys
npm run dev
```

The database is PGlite locally (no setup) and Neon in production. The schema runs on start.

## Before you open a pull request

```
npm run typecheck
npm test
npm run build
```

All three must pass. Logic changes come with a test that failed first.

## House rules

- No AI and no agent may ever move money. Only the spotter's PIN approves a payment. Pull requests that weaken this are closed.
- Untrusted text never goes to a model without the cleaning in `src/ai/sanitize.ts`.
- Never commit secrets. Keys live in `.env.local`, which git ignores.
- Copy is plain English: no em or en dashes, straight quotes.
