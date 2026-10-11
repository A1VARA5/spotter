# Contributing

Spotter is a hackathon project (PayPal AI Hackathon 2026), so the code moves fast. Issues and ideas are welcome, and so are pull requests that keep the house rules below.

## Run it locally

```bash
npm ci
cp .env.example .env.local   # add your own PayPal sandbox and Anthropic keys
npx next dev -p 3417
```

The database is PGlite locally (no setup) and Neon in production. The schema runs on start. How the pieces fit together is in [docs/architecture.md](docs/architecture.md).

## Before you open a pull request

```bash
npm run typecheck
npx vitest run
npm run build
```

All three must pass, and CI runs the same three. Logic changes come with a test that failed first. Paid calls (Claude, KERNEL, Channel3) are faked in tests, so the suite costs nothing to run.

## House rules

- No AI and no agent may ever move money. Only the spotter's PIN approves a payment. Pull requests that weaken this are closed.
- Untrusted text never goes to a model without the cleaning in `src/ai/sanitize.ts`.
- Anything new that costs money per call gets a daily cap.
- No semicolons in schema comments. Neon splits the DDL on `;`, and `src/db/schema.test.ts` will tell you.
- Never commit secrets. Keys live in `.env.local`, which git ignores.
- Copy is plain English: no em or en dashes, straight quotes.

Security problems go through private reporting, see [SECURITY.md](SECURITY.md). Everyone taking part agrees to the [code of conduct](CODE_OF_CONDUCT.md).
