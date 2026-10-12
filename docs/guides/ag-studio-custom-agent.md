# A custom AG Studio agent that lets the built in agents do the building

On the live site, typing "What did Leo spend on games?" into Watchtower put a chart on the board in 19.5 s with 14 tool calls (11 October). My own agent configured none of it. It placed one empty tile, then handed the chart to the Widget agent and the sum to the Data agent that ship with AG Studio 3.0. Here's how, and what broke on the way.

<img src="../media/spotter-ag-studio.gif" alt="Typing the Leo question: Spotter places a tile, the Widget and Data agents build it, and the receipt shows 0 money actions with an Undo button">

## The roster

[src/watchtower/agents.ts](../../src/watchtower/agents.ts) builds one list: my agent `spotter` as primary, a second agent `brief` that writes a weekly page, and the five built in agents (lead, planning, data, page, widget) with Spotter context added. [Studio.tsx](../../src/app/watchtower/Studio.tsx) pairs each one with `directLlmRunner` and my adapter:

```ts
const inner = createAiHarness(api, ({ builtIn }) => {
  const roster = buildRoster({ builtIn, extra: { caseFile, alerts, radar, paypal, price, fair, addPage, place }, context, demo });
  return {
    agents: roster.agents.map((d) => directLlmRunner({ ...d, adapter: spotterAdapter(undefined, d.id) })),
    primary: roster.primary,
    history,
    observers: [recorder],
  };
});
```

The thing that took me longest to see: the built in lead delegates to a fixed set of ids, so a new agent is only reachable from a lead you write yourself. So `spotter` carries its own `tools.delegateTo(["brief", "data", "planning", "page", "widget"])`. Its other tools only read (`open_case_file`, `watch_alerts`, `scam_radar`, `paypal_status`, `real_price`, `fair_prices`), and two touch the board (`add_page`, `place_widget`).

## place_widget, then two delegations in one turn

`place_widget` puts an empty tile titled for the question at the top of an Answers page and returns `widgetType`, `widgetId` and `pageId`. Only chart and table types from `api.getAiContext().catalogue()` can be placed. On the next turn `spotter` sends both of these side by side:

- `delegate_to` widget, with the ids and a one sentence brief naming the fields and filters
- `delegate_to` data, for the total with the same filters, so the chart and the sentence in chat agree

The same question again brings back the same tile. Locally the tile then appeared in 1.5 to 2.5 s, and the full answer took 13.7 to 16.2 s.

## The receipt comes from telemetry

The assistant reads payee names that scammers wrote, so I don't take its word for what it did. [src/watchtower/receipt.ts](../../src/watchtower/receipt.ts) is an `AgAiTelemetryObserver` that folds each run, delegated sub runs included, into tool names, counts and times. No prompts, arguments or results are kept. Every tool Watchtower can call is listed in `TOOL_ACCESS` as read, chat or board. Anything else counts as a money action, turns the line red and flags the run. The Leo run reads "Money actions: 0".

**Undo what Spotter changed** ([runUndo.ts](../../src/watchtower/runUndo.ts)) notes the Studio history ids when a run starts, and Undo calls `undo(id)` on exactly the entries added since. AI tool changes and `setState` both land in history, which I checked in the running app. After a remount the ids mean nothing, so Undo falls back to the board saved at run start, only while the board is still as the run left it.

`aiToolDisplay` cards are built from counts and fixed labels only, so a payee name can never become a card title.

## A model per agent

The browser only sends the agent id, and `modelFor` in [llm.ts](../../src/watchtower/llm.ts) picks: `spotter` and Gran's agent on `claude-sonnet-5-5`, the builders on `claude-opus-5-5`. The key stays on the server, with 60 turns per family and 600 a day taken in one SQL insert. Haiku was faster again, but once it told a family they paid fair prices when they had overpaid, so it's out.

## The chart polish hook

AG Studio has no colours per value, and a saved widget format can't put a currency on an axis. [chartPolish.ts](../../src/app/watchtower/chartPolish.ts) wraps `AgCharts.create` and `chart.update` once per page load: neutral colours on answer tiles, pounds on money axes, slim lone bars. If polishing throws, Studio's own chart is drawn. `ag-charts-enterprise` is pinned at 14.2.0 so both sides import the same `AgCharts`.

## When an answer doesn't finish

"Building your chart" only shows while a run is live in this tab. An empty newest tile with nothing running (tab closed, reload, Stop, a remount) says "This answer didn't finish" with **Ask again**, which reuses the same tile. A tile the Widget agent never set up comes off when the run ends, with a note in chat.

## The remount

AG Studio 3.0 reads `data` once, and new rows don't redraw the board. Until the real time update AG announced for about 28 October, Watchtower remounts `<AgStudio>` with a new key, carrying the board as it is. It waits while a run is going or a message is half typed.

## What went wrong and how I fixed it

| What happened | What I changed | Where |
| --- | --- | --- |
| My own test round typed the Leo question and got a paragraph in chat, "Board changes: 0", after 16.4 s | `place_widget`, then widget and data delegations in the same turn | `6fee7e7` |
| "Did we pay fair prices?" called a £6.99 skillet from a suspected fake shop "a good price" | `fair_prices` hands over `too_cheap_to_be_real` as data, and the role says it's never a saving | `6fee7e7` |
| The fair price answer took about 20.7 s (5 Opus turns and a hop to the Data agent) | One `fair_prices` tool and Sonnet for `spotter`: 5 to 8 s locally, 5.0 s live with 1 tool call | `ddddcdb` |
| New payments never appeared on an open board | Remount with a new key, waiting while anyone is busy | `4b3bc3a` |
| The receipt could say 0 board changes when the snapshot was missing | It says "couldn't be checked", and an unknown tool seen only at the end still flags the run | `fe945da` |
| The assistant answered from the sample month without saying so | Its role makes it say "From the sample month" | `5d4e790` |
| A chart with one shop drew its bar as a block across the whole tile | Slim bars when there are fewer than 8 | `cf31082` |
| Outcome colours followed the order rows arrived in, not the outcome | Rows sorted worst first, the palette built from the outcomes present, then the polish hook | `7f9fbea`, `d12d488` |

## Run it

```bash
npm ci
# .env.local: NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY, ANTHROPIC_API_KEY
npx next dev -p 3417
npx vitest run src/watchtower src/app/watchtower   # 28 files, 456 tests on 12 Oct
```

Off localhost, AG Studio shows its watermark without a licence key. Mine is a trial that ends on 24 November 2026.

## Try it yourself

1. Open https://spotter-pay.vercel.app and press **Try it on fake money**.
2. Open **Watchtower** and type "What did Leo spend on games?". Watch the empty tile appear, then fill.
3. Read the receipt under the board, then press **Undo what Spotter changed**.
4. Ask "Did we pay fair prices this month?" and compare the answer with the Fair price tile.
