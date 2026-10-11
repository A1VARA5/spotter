# Changelog

What changed each day, from the git history. Dates are the commit dates. Spotter is built for the PayPal AI Hackathon 2026, so every day so far is a build day.

## 2026-10-11

PayPal and agents
- One coverage table for all 47 PayPal Agent Toolkit tools drives the guarded MCP server per agent job. Shopping agents get 35 tripwire tools that never run and freeze the agent when called.
- Selling agent guard: refunds held for the PIN and only to the original capture, tracking only after a completed capture. Subscriptions held in PayPal's APPROVAL_PENDING with the cost tail shown first. Cut up payments caught.
- Agent keys: daily rate limits on both MCP routes, a per key call log, a key card with Switch off now, a canary key that freezes the agent and burns its keys, and `custom_id` from the key's label on every agent order.
- The agent lab (`/agent-lab`): a scripted naive test agent springs a tripwire against the real guarded server, and PayPal voids its hold.
- Money safety: unconfirmed voids and captures retry instead of failing with a live hold, a `PayPal-Request-Id` on void, capture, reauthorize and refund, and a crash after the hold keeps the payment in front of the spotter.
- Webhooks: `PAYMENT.CAPTURE.DECLINED` and `IDENTITY.AUTHORIZATION-CONSENT.REVOKED` handled, 9 events in all. A declined capture stays failed when a late event arrives.
- "Ask again tomorrow" on a held payment, with PayPal reauthorize once from day 4.
- "Was it you?" asks the family member a scam message pretends to be. Their "Not me" voids the hold.

KERNEL and Channel3
- Look at a case file's page safely, live, through relayed screenshots.
- Tool poisoning check (WebMCP tools listed, never run), two faces (desktop and UK phone at the same moment), where the money goes and proof Spotter never touched the page.
- Price watch with Channel3 tracking, spot the difference with image search, photo price check, priced like a used one.
- One Channel3 going rate per card: UK shops only for pounds, one price per shop, the same department.

Watchtower and the app
- Gran's view in her own language (Polish), the AI's receipt from AG Studio's telemetry with undo, fair prices in two turns.
- Telegram reads screenshots (Claude vision copies the words, then the normal check runs).
- Printable evidence pack, switched off alerts, folded case files, one layout system, a landing page rebuild.
- Fixed: a semicolon in a schema comment broke production only (Neon splits DDL on `;`). A test guards it.
- Repo: SECURITY, CONTRIBUTING, issue and PR templates, CI.

## 2026-10-10

- Case agent with read only tools, the Spotter network, safe swap, Telegram and Discord channels.
- Verified PayPal webhooks that record the truth and settle stuck payments, and a daily reconcile job.
- KERNEL: opening suspicious links in a throwaway cloud browser, seen vs read, the GadgetBarn demo shop, replays.
- Watchtower on AG Studio: saved boards, incident pages, money in mid air, replay, scam radar, Spotter's own agent leading AG's built in agents, a weekly brief agent, the fair price widget.
- PayPal Agent Toolkit tools with a spotter at `/api/toolkit/mcp`, and the first real toolkit agent run.
- Business mode: household kind, presets, changed bank details sign, business scenarios.
- The safer option when Spotter stops an agent's payment for shop reasons.
- PIN on every approval, accessibility fixes (focus, live regions, dialog ids), and a demo family that opens with one real sandbox hold.

## 2026-10-09

- Rules engine, PayPal sandbox client (authorise, capture, void), grounded AI check, decision, payment lifecycle on Postgres with race safe approvals.
- Review round 1 and 2: fail closed on AI outage, spotter PIN, allowance race, injection hardening, honest errors.
- MCP server for AI agents with no approve tool, Channel3 price check, AG Grid Activity table.
- Households, Log in with PayPal, a private demo family per visitor, guided setup, pairing codes and per agent keys.
- Email channel, the landing page, the app shell, the How Spotter works page.
- Reconcile payments stuck mid capture against PayPal.
