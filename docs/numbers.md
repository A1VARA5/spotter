# Numbers

Every number the README, the guides and the Devpost text quote comes from this page. Prose rounds them ("over 1,800 tests", "about 18 s") so it doesn't go stale every time a test lands. The exact figures live here and in the README timings table. When a number changes, change it here first, then the rounding where it shows up.

## Tests

| What | Number | Date | Source |
| --- | --- | --- | --- |
| Full suite | 1,812 tests in 138 files, all passing | 12 Oct 2026 | `npx vitest run --maxWorkers=4` on my laptop, 196 s, no timeouts |
| AG Studio guide command | 456 tests in 28 files | 12 Oct 2026 | the command in [the AG Studio guide](guides/ag-studio-custom-agent.md#run-it) |
| Channel3 guide command | 205 tests in 10 files | 12 Oct 2026 | the command in [the Channel3 guide](guides/channel3-price-checks-that-change-decisions.md#run-it) |
| KERNEL guide command | 153 tests in 10 files | 12 Oct 2026 | the command in [the KERNEL guide](guides/kernel-seen-vs-read.md#run-it) |
| Agent Toolkit guide command | 66 tests in 6 files | 12 Oct 2026 | the command in [the toolkit guide](guides/paypal-agent-toolkit-tripwires.md#run-it) |

The 12 October judge round saw 6 tests in 5 files time out on a laptop under full parallel load (PGlite setup hooks over 10 s, and those files passed alone). Commit `050829a` raised the local test and hook timeouts to match CI, and `--maxWorkers=4` keeps the load down too.

## Live timings

All on https://spotter-pay.vercel.app with a fresh demo family, from the round 7 judge pass on 12 October 2026 (about 01:20 to 02:05 BST, live build of commit `173bd21`) unless the row says otherwise.

| Step | Number | Prose says |
| --- | --- | --- |
| Try it on fake money to a dashboard with the £250 hold | heading and held card there at the 1.0 s sample | about a second |
| The four tour scenarios, Send it to the verdict | 4.3 to 8.3 s (11 October walkthrough). Round 7 timed the £4.99 skillet at 6.3 s, with "Checking" 250 ms after the click | about 4 to 8 s |
| Was it you?, Tom's Not me to "Your money is safe" | 1.4 s (12 October, about 02:30 BST, two runs at 1.36 and 1.37 s while recording the Gran clip) | about a second |
| Case files settled after opening the dashboard | 2.3 s | a few seconds |
| Approve with the PIN (2468) to paid | 1.9 s | about 2 s |
| Agent lab, Hijack the agent | `create_order` held at +4.4 s, frozen and the hold voided at +5.3 s, verified PayPal webhook at +11.3 s | about 5 s, webhook about 11 s |
| Watchtower, "What did Leo spend on games?" | receipt "14 calls in 15.8 s, Money actions 0, Board changes 8" (12 October, 02:31 BST, while recording the README clip) | about 16 s, 14 tool calls |
| Watchtower, "Did we pay fair prices this month?" | receipt "2 calls in 6.0 s" | about 6 s, 2 tool calls |
| Photo price check, the example photo | 0.9 s (probably cached) | under a second |

## Costs

| What | Number | Date | Source |
| --- | --- | --- | --- |
| AI check (`claude-opus-5-5`) | about 1p a check | 9 to 11 Oct | my scenario runs |
| Case agent (`claude-opus-5-5`) | about 5p a case | 10 Oct | `scripts/case-smoke.ts` runs |
| Watchtower, the Leo question on a fresh family | about $0.37 (6 Opus 5.5 turns, 4 Sonnet 5.5 turns, mostly writing the prompt cache) | 12 Oct | token counts the route logs per turn, at list prices |
| KERNEL case with two faces | about $0.002 | 11 Oct | [docs/kernel-notes.md](kernel-notes.md) |
| KERNEL look at it safely (90 s) | about $0.012 | 11 Oct | [docs/kernel-notes.md](kernel-notes.md) |
| Channel3 | 1 credit per search, 1 credit per tracked product per day, $0.007 a credit after 1,000 free a month | 12 Oct | [docs/channel3/pricing.md](channel3/pricing.md) |
| PayPal sandbox | free | | |

## Live data

| What | Number | Date | Source |
| --- | --- | --- | --- |
| axe (WCAG 2.2 AA tags) | 0 violations on 16 routes at 390 and 1440 px | 12 Oct | round 7 judge pass on the live site |
| Shared Channel3 price watch | tracking since 11 Oct 22:17 UTC, 0 points recorded yet, two shop prices £199.00 and £229.00 | 12 Oct, 00:50 UTC | `GET /api/watches/shared` for a fresh demo family |

## Where they're used

- [README.md](../README.md): Technology, the timings table, Run it locally.
- The four guides in [docs/guides](guides/README.md).
- The Devpost story and form answers, which live outside this repo.

## Refreshing them

```bash
npx vitest run --maxWorkers=4
```

Then time the steps above on the live site with a fresh demo family, write the date and the build next to them here, and fix the rounding where it changed.
