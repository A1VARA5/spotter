# Spotter design system (v1, 2026-10-09)

## The world

A spotter is the person standing behind the bench with their hands ready under the bar. You lift on your own; they only step in when it matters. The product's one job on screen is to show **a payment held in mid air**: money that has left the spender but not yet reached the payee, paused at a checkpoint, with the reason in plain words and the spotter's two buttons.

Use scene: the spotter glances at their phone during the day; Gran reads on a tablet at the kitchen table; a PayPal judge watches a 3 minute video. So: **light, calm, high contrast, big readable money**, phone first.

## The one bold thing: the hold track

Every payment is drawn as a short horizontal track: **spender ── [ Spotter ] ── payee**. The amount sits on the track. Where it is tells you its state:
- moving through to the payee: allowed and paid;
- stopped at the checkpoint with an amber clamp: held, waiting for the spotter;
- turned back with a red stop: blocked;
- rerouted through a cobalt "protected" lane: unsafe method swapped for a protected PayPal order.

Everything else stays quiet so this reads instantly.

## Colour (semantic first, decoration never)

| Token | Hex | Use |
|---|---|---|
| `--chalk` | `#F3F5F2` | page background: cool chalk white, not cream |
| `--ink` | `#17212B` | text and the track line |
| `--ink-2` | `#4A5866` | secondary text (contrast 7:1 on chalk) |
| `--line` | `#D5DBD6` | rules and dividers |
| `--hold` | `#F2B705` | held / needs you (safety pin yellow); text on it is `--ink` |
| `--go` | `#1F7A55` | allowed, paid |
| `--stop` | `#BE3328` | blocked |
| `--protect` | `#2C55C9` | protected lane |
| `--paper` | `#FFFFFF` | raised surfaces (held cards, phone frame) |

Colour always carries a state; no gradients, no tinted washes.

## Type

One family: **Schibsted Grotesk** (self hosted via next/font). Sturdy, warm newspaper grotesk; reads well large for Gran.
- Money: 600 weight, tabular numerals, the largest thing on any card.
- Scale (1.25): 13 / 16 / 20 / 25 / 31 / 39 / 61 (landing headline only). Body 16 to 18, line height 1.5, measure under 70ch.
- Sentence case everywhere. No all caps labels, no eyebrows, no monospace.

## Layout

- Phone (spotter): stack of held payments at the top ("Waiting for you"), then the day's feed as a ruled list (rows, not cards).
- Desktop: two columns. Left 7/12: held payments with their tracks and evidence. Right 5/12: the feed. The demo control panel lives on its own page.
- Landing: left aligned. Headline, one sentence, then the live hold track replaying three real scenarios (agent, Gran, kid). No stat strip, no feature card grid.

```
Landing (desktop)
+------------------------------------------------------------+
| Spotter                                   Try the demo      |
|                                                            |
| Every payment gets a spotter.                              |
| Spotter holds the money for a moment, checks it, and asks  |
| someone you trust when it matters.                         |
|                                                            |
|  Gran ─────── [ ▮ held £400 ] ─────── "new number"         |
|  "Friends and Family please"  ← quoted, highlighted         |
|                     [ Approve ]  [ Deny ]                   |
+------------------------------------------------------------+
```

## Evidence

Quoted evidence is shown inside the original message, highlighted in place (`<mark>` with the state colour at 25% and a 2px underline), not as a separate bullet list. That's the product's honesty made visible: you see exactly the words that triggered it.

## Shape and depth

- Radius by hierarchy: held card 18px, buttons 12px, inline marks 4px, feed rows 0 (ruled).
- One shadow for raised paper: `0 1px 2px rgb(23 33 43 / .06), 0 8px 24px -12px rgb(23 33 43 / .18)`.
- Icons: lucide, 1.75 stroke, never emoji as icons.

## Motion

One authored moment: when a payment arrives, the amount travels along the track and the clamp closes (250ms, ease-out-expo). Approve slides it on to the payee; Deny drops it back to the spender. Respect reduced motion (states change without travel). No entrance animations on sections.

## Browser surfaces

Selection `--hold` at 40%; focus ring 3px `--protect` with 2px offset; caret `--ink`; tabular numerals in every amount; underline offset 3px.

## Review against generic defaults (what I changed)

- First instinct was a dark fintech dashboard with a neon accent: that's default 2. Switched to light chalk, chosen from the use scene.
- Considered cream + serif for warmth: default 1. Kept warmth through the grotesk and the yellow instead.
- Considered a card grid of features on the landing: default 4. Replaced by the live hold track.
- Status chips in all caps with mono: default 5. Status is shown by position on the track plus a sentence.
