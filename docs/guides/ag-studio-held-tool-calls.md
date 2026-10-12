# Holding AG Studio tool calls for a person

The AG Studio 3.0 chat types already have a way to stop a tool call and ask a person. `AgAiChatSession.respond(toolCallId, { type: "approve" | "reject" })`, a run status `awaiting_input` and a tool status `awaiting_approval` are all in `ag-studio/dist/types/api/ai/agAiChat.d.ts`. The comment next to them says Studio's own harness does not pause for approval yet, and that the surface is there for a harness of your own. So I wrote that part.

Why Watchtower needs it: the assistant reads payee names and case notes, and some of those were written by scammers. If one of them ends up as a page title or a tile on the family's board, the board is now saying the scammer's words in Spotter's voice. So a board change that carries those words waits for the spotter.

## What counts as a scammer's words

[src/watchtower/hold.ts](../../src/watchtower/hold.ts) builds the list with `scammerTexts`: payee names from payments Spotter held, stopped, denied or protected, or that have a scam sign, plus the reasons and findings in case notes. Clean paid payees are left out. My first version counted every payee, so "Payments to Tesco Superstore" would have waited for no reason.

`carries(taint, args)` lower cases and flattens every string in the call's arguments and looks for a shared run of 12 or more characters. Shorter overlaps don't count, so "Amazon" in a title doesn't trip it. It returns the matched words, which go on the card.

## Wrapping the tools, not replacing the harness

A tool's `execute` is async, so it can wait. `gated(tool, gate, taint)` swaps in an `execute` that checks the arguments first:

```ts
if (!hit.hit) return run(call, ctx);              // authorised, runs straight away
const a = await gate.ask({ toolCallId, name, quote, threadId, signal: ctx.signal });
if (a !== "approve") return ctx.error(REFUSED);  // the agent is told the spotter refused
return run(call, ctx);                            // allowed by the spotter
```

If the check itself throws, the call waits. It never runs unchecked.

Every agent's `tools()` result is wrapped, including the built in agents from `createAiHarness`'s `builtIn`, so Studio's own `add_widget` and `configure_widget` wait too. Tools the receipt lists as read only are never held.

Then `holdingHarness(inner, gate)` is a Proxy around AG's harness, the same trick as my `focusable` wrapper. While a chat has a call waiting, its session reports `status: "awaiting_input"` and that call reports `awaiting_approval`, and `respond` answers the gate. Stop, closing the chat, deleting it or a remount all refuse whatever is waiting, so nothing runs later by surprise.

## The UI

AG's chat panel has no approve or refuse buttons, and it keeps a tool card folded until you click it. So the buttons live in two places of mine: the tool card (`aiToolDisplay`) and a bar above the board that lists every waiting call. Both show "Held for you", the quoted words as plain text, Allow and Refuse.

The receipt adds one line, counted like a PayPal hold: "AI actions: authorised N, allowed N, refused N." Authorised means it ran because it carried none of a scammer's words.

## What broke

- The bar above the board read `gate.pending()` through `useSyncExternalStore`, and `pending()` built a new array on every call. React took that as "always changed" and warned about an infinite loop. All the unit tests passed. I only saw it in the browser. Now the gate keeps one array per change.
- While a call waits, AG's panel hides its Stop button and keeps the message box open, and a message typed then is dropped. Refuse is the way out.

## Trying it

On a demo family, open **Try to trick it** on the Watchtower toolbar:

- **A test agent reads a scam text** runs a script with two fake tools through the same gate, harness off then on. Free, and nothing can reach PayPal.
- **Ask the assistant to copy a scammer's words** asks the real assistant to title a page with Gran's planted £49.99 payee. On 12 October that call was held, I refused it, and the receipt said refused 1.

Tests: [src/watchtower/hold.test.ts](../../src/watchtower/hold.test.ts) and [src/watchtower/jar.test.ts](../../src/watchtower/jar.test.ts).
