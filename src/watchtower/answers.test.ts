import { describe, expect, it } from "vitest";
import { ANSWER_COLOURS, answerLine, answerReceipt, answeredLine, receiptSteps, FAIR_FAILED, answerTotal, builtBy, dropEmptyAnswers, followUps, isEmptyAnswer, moneyFieldsOf, polishChart } from "./answers";
import { SUMMARY_ID, SUMMARY_TYPE, newestAnswer } from "./pages";
import { startedReceipt, type Receipt } from "./receipt";

type W = { type: string; dataMapping?: Record<string, Array<{ id: string; aggregation?: string }>> };
const board = (answers: Record<string, W>) =>
  ({
    pages: [
      { id: "month", name: "This month", widgets: {}, widgetLayout: {} },
      { id: "page-answers", name: "Answers", widgets: answers, widgetLayout: Object.fromEntries(Object.keys(answers).map((id, i) => [id, { xTrack: 0, yTrack: i * 14, xSpan: 24, ySpan: 14 }])) },
    ],
    selectedPageId: "page-answers",
  }) as never;

const money = moneyFieldsOf([
  {
    id: "payments",
    fields: [
      { id: "amount", format: "currencyFormat", formatOptions: { format: "£#,##0.00" } },
      { id: "who", format: "textFormat" },
    ],
  },
]);

// What Studio hands AG Charts for one chart (trimmed): its own theme, axes and the widget as context.
const studioOptions = (widgetId: string, dataMapping: W["dataMapping"], horizontal = true) => ({
  context: { params: { widgetId, dataMapping } },
  theme: { baseTheme: { baseTheme: "ag-default" }, params: { fontFamily: "x" }, palette: { fills: ["#BE3328", "#1F7A55"], strokes: ["#BE3328", "#1F7A55"] }, overrides: { common: { legend: { enabled: false } } } },
  axes: horizontal ? { x: { type: "number", label: { fontSize: 12 } }, y: { type: "category" } } : { x: { type: "category" }, y: { type: "number" } },
  series: [{ type: "bar" }],
});
const byShop = { categoryKey: [{ id: "payments.payee" }], valueKey: [{ id: "payments.amount", aggregation: "sum" }] };

describe("money fields", () => {
  it("finds the currency fields and their symbol from the board's data", () => {
    expect([...money.fields]).toEqual(["payments.amount"]);
    expect(money.symbol).toBe("£");
  });
});

describe("answer chart colours", () => {
  it("gives an answer chart the neutral palette, never the Stopped red, and keeps the rest of Studio's theme", () => {
    const o = polishChart(studioOptions("answer-1", byShop), money) as ReturnType<typeof studioOptions>;
    expect(o.theme.palette).toEqual({ fills: ANSWER_COLOURS, strokes: ANSWER_COLOURS });
    expect(ANSWER_COLOURS.map((c) => c.toLowerCase())).not.toContain("#be3328");
    expect(o.theme.params).toEqual({ fontFamily: "x" });
    expect(o.theme.overrides).toEqual({ common: { legend: { enabled: false } } });
  });

  it("keeps outcome colours when the answer is split by outcome (red there means stopped)", () => {
    const o = polishChart(studioOptions("answer-1", { categoryKey: [{ id: "payments.who" }], legendKey: [{ id: "payments.outcome" }], valueKey: [{ id: "payments.id", aggregation: "count" }] }), money) as ReturnType<typeof studioOptions>;
    expect(o.theme.palette.fills[0]).toBe("#BE3328");
  });

  it("leaves the board's own charts on the outcome palette", () => {
    const o = polishChart(studioOptions("people", byShop), money) as ReturnType<typeof studioOptions>;
    expect(o.theme.palette.fills[0]).toBe("#BE3328");
  });
});

describe("answer value labels", () => {
  it("puts the value on each bar of an answer chart, keeping Studio's label settings", () => {
    const opts = { ...studioOptions("answer-1", byShop), series: [{ type: "bar", yKey: "v", label: { fontSize: 12 } }] };
    const o = polishChart(opts, money) as any;
    expect(o.series[0].label).toEqual({ fontSize: 12, enabled: true, color: "#17212B", placement: ["inside-end", "outside-end"] });
    // the first answer colour holds ink text at AA and stands off white at 3:1 or more
    expect(ANSWER_COLOURS[0]).toBe("#6F8BD8");
  });

  it("leaves the board's own bars without labels", () => {
    const o = polishChart({ ...studioOptions("people", byShop), series: [{ type: "bar", yKey: "v" }] }, money) as any;
    expect(o.series[0].label).toBeUndefined();
  });
});

describe("an answer's total", () => {
  const withData = (widgetId: string, rows: Array<Record<string, unknown>>, series: Array<Record<string, unknown>>, mapping = byShop) => ({ ...studioOptions(widgetId, mapping), data: rows, series });

  it("adds up what the answer chart shows, in pounds for money", () => {
    const t = answerTotal(withData("answer-1", [{ p: "BlockWorld", v: 4.99 }, { p: "TuneBox", v: 4.99 }], [{ type: "bar", yKey: "v" }]), money);
    expect(t).toMatchObject({ widgetId: "answer-1", text: "£9.98" });
  });

  it("adds every series and counts plainly when the chart counts", () => {
    const counts = { categoryKey: [{ id: "payments.who" }], valueKey: [{ id: "payments.id", aggregation: "count" }] };
    const t = answerTotal(withData("answer-2", [{ a: 2, b: 1 }, { a: 3, b: "x" }], [{ type: "bar", yKey: "a" }, { type: "bar", yKey: "b" }], counts), money);
    expect(t).toMatchObject({ widgetId: "answer-2", text: "6" });
  });

  it("reads a donut's slices", () => {
    const t = answerTotal(withData("answer-3", [{ v: 10 }, { v: 5.5 }], [{ type: "donut", angleKey: "v" }]), money);
    expect(t?.text).toBe("£15.50");
  });

  // R7 m1: the card shows the rows behind the chart instead of an empty grey box.
  it("names the biggest three rows behind the chart with their amounts, biggest first", () => {
    const rows = [{ p: "TuneBox", v: 6 }, { p: "BlockWorld", v: 4.99 }, { p: "PixelPals", v: 12.5 }, { p: "Arcadia", v: 1 }];
    const t = answerTotal(withData("answer-1", rows, [{ type: "bar", xKey: "p", yKey: "v" }]), money);
    expect(t?.top).toEqual([
      { label: "PixelPals", value: "£12.50" },
      { label: "TuneBox", value: "£6.00" },
      { label: "BlockWorld", value: "£4.99" },
    ]);
    // rows without a plain label aren't listed (no guessing), so the list can be shorter
    expect(answerTotal(withData("answer-1", [{ v: 2 }, { v: 3 }], [{ type: "bar", yKey: "v" }]), money)?.top).toEqual([]);
  });

  it("has nothing to say about the board's own charts or a chart with no rows", () => {
    expect(answerTotal(withData("people", [{ v: 1 }], [{ type: "bar", yKey: "v" }]), money)).toBeNull();
    expect(answerTotal(withData("answer-1", [], [{ type: "bar", yKey: "v" }]), money)).toBeNull();
  });
});

describe("money axes", () => {
  it("labels the value axis in pounds when a chart adds up money, on any page, sideways or upright", () => {
    const side = polishChart(studioOptions("answer-1", byShop, true), money) as any;
    expect(side.axes.x.label).toEqual({ fontSize: 12, format: "£,~f" });
    expect(side.axes.y.label).toBeUndefined();
    const up = polishChart(studioOptions("people", byShop, false), money) as any;
    expect(up.axes.y.label).toEqual({ format: "£,~f" });
  });

  it("reads the fields as Studio hands them to a chart (fieldId and key, not id)", () => {
    const hydrated = { categoryKey: [{ fieldId: "payments.who", key: "payments.who" }], valueKey: [{ fieldId: "payments.amount", key: "payments.amount|sum", aggregation: "sum" }], legendKey: [{ fieldId: "payments.outcome", key: "payments.outcome" }] };
    const o = polishChart(studioOptions("answer-1", hydrated as never, false), money) as any;
    expect(o.axes.y.label).toEqual({ format: "£,~f" });
    expect(o.theme.palette.fills[0]).toBe("#BE3328"); // split by outcome
  });

  it("leaves counts as plain numbers", () => {
    const o = polishChart(studioOptions("people", { categoryKey: [{ id: "payments.who" }], valueKey: [{ id: "payments.amount", aggregation: "count" }] }), money) as any;
    expect(o.axes.x.label).toEqual({ fontSize: 12 });
  });

  it("leaves anything that isn't a Studio widget chart alone", () => {
    const plain = { series: [{ type: "bar" }] };
    expect(polishChart(plain, money)).toBe(plain);
  });
});

describe("empty answer tiles", () => {
  it("knows a placed tile the widget agent never set up", () => {
    expect(isEmptyAnswer({ type: "bar-chart-grouped" })).toBe(true);
    expect(isEmptyAnswer({ type: "bar-chart-grouped", dataMapping: { categoryKey: [], valueKey: [] } })).toBe(true);
    expect(isEmptyAnswer({ type: "bar-chart-grouped", dataMapping: byShop })).toBe(false);
    // Spotter's own tiles take no data mapping and are never empty
    expect(isEmptyAnswer({ type: "fair-price" })).toBe(false);
  });

  it("drops only the empty answer tiles and closes the gap they left", () => {
    const s = board({ "answer-2": { type: "donut-chart" }, "answer-1": { type: "bar-chart-grouped", dataMapping: byShop } });
    const r = dropEmptyAnswers(s);
    expect(r.removed).toEqual(["answer-2"]);
    const page = (r.state as unknown as { pages: Array<{ id: string; widgets: Record<string, W>; widgetLayout: Record<string, { yTrack: number }> }> }).pages[1]!;
    expect(Object.keys(page.widgets).filter((id) => id.startsWith("answer-"))).toEqual(["answer-1"]);
    expect(page.widgetLayout["answer-1"]!.yTrack).toBe(0);
  });

  it("returns the same board when every answer tile is set up", () => {
    const s = board({ "answer-1": { type: "bar-chart-grouped", dataMapping: byShop } });
    expect(dropEmptyAnswers(s)).toEqual({ state: s, removed: [] });
  });
});

// N5 (round 4): a question cut off mid run (tab closed, reload, navigated away) left its empty tile under a
// "Building your chart..." header on every reload. Only a run live in this tab may show the placeholder; an
// empty newest tile with nothing running says it didn't finish (with Ask again), on every device.
describe("answers that didn't finish", () => {
  const empty = { pageId: "page-answers", widgetId: "answer-2", title: "What Leo spent on games", empty: true };
  const done = { pageId: "page-answers", widgetId: "answer-1", title: "Spending by shop", empty: false };

  it("shows Building only while a run is live in this tab", () => {
    expect(answerLine(empty, true)).toEqual({ kind: "building", pageId: "page-answers", title: "What Leo spent on games" });
  });

  it("says an empty tile with no run behind it didn't finish (a reload, another device, a closed tab)", () => {
    expect(answerLine(empty, false)).toEqual({ kind: "unfinished", pageId: "page-answers", title: "What Leo spent on games" });
  });

  it("names a finished answer whether or not something else is running, and nothing without an answer", () => {
    expect(answerLine(done, false)).toEqual({ kind: "answer", pageId: "page-answers", widgetId: "answer-1", title: "Spending by shop" });
    expect(answerLine(done, true)).toEqual({ kind: "answer", pageId: "page-answers", widgetId: "answer-1", title: "Spending by shop" });
    expect(answerLine(null, false)).toBeNull();
  });

  it("a saved board with an interrupted tile opens with it as the newest answer, which nothing is building", () => {
    const s = board({ "answer-2": { type: "bar-chart-grouped", dataMapping: {} }, "answer-1": { type: "bar-chart-grouped", dataMapping: byShop } });
    const latest = newestAnswer(s);
    expect(latest).toMatchObject({ widgetId: "answer-2", empty: true });
    // nothing runs when the page opens
    expect(answerLine(latest, false)?.kind).toBe("unfinished");
  });
});

describe("the summary card beside the newest answer", () => {
  const r = (runId: string, tools: string[], extra: Partial<Receipt> = {}): Receipt => ({
    runId,
    threadId: "t1",
    agentId: "spotter",
    startedAt: 1,
    ms: 15_400,
    status: "ok",
    turns: 3,
    tokens: { input: 1, output: 1 },
    tools: tools.map((name) => ({ name, calls: 1, ms: 1, failed: 0, access: "read" as const })),
    helpers: ["widget", "data"],
    unknown: [],
    moneyActions: 0,
    boardChanges: 6,
    boardKnown: true,
    flagged: false,
    ...extra,
  });

  it("uses the receipt of the newest run that placed a tile, skipping chat only runs and runs that didn't finish", () => {
    const placed = r("r1", ["place_widget", "delegate_to"]);
    const chat = r("r2", ["open_case_file"]);
    const cut = startedReceipt({ runId: "r3", threadId: "t1", agentId: "spotter", startedAt: 2 });
    const stopped = r("r4", ["place_widget"], { status: "cancelled" });
    expect(answerReceipt([cut, stopped, chat, placed])).toBe(placed);
    expect(answerReceipt([chat])).toBeNull();
    const failed = r("r5", ["place_widget"]);
    failed.tools[0]!.failed = 1;
    expect(answerReceipt([failed, placed])).toBe(placed);
  });

  // R7-N1: what the chat says for a run that built its tile and kept its receipt but wrote no reply.
  describe("the chat's plain line for a finished answer", () => {
    const leo = { widgetId: "answer-1", type: "bar-chart-grouped", title: "What Leo spent on games", empty: false };
    const done = r("r1", ["place_widget", "delegate_to"]);
    it("names the chart and its total", () => {
      expect(answeredLine({ placed: "answer-1", latest: leo, total: "£9.98", receipt: done })).toBe("Chart added: What Leo spent on games, £9.98.");
      expect(answeredLine({ placed: "answer-1", latest: leo, receipt: done })).toBe("Chart added: What Leo spent on games.");
      expect(answeredLine({ placed: "answer-1", latest: { ...leo, type: "grid" }, total: "£9.98", receipt: done })).toBe("Table added: What Leo spent on games.");
      expect(answeredLine({ placed: "answer-1", latest: { ...leo, type: "fair-price", title: "Did we pay fair prices this month?" }, line: "Your agent paid £8.50 more", receipt: done })).toBe("Fair price tile added: Did we pay fair prices this month.");
    });
    it("says nothing unless this run's own tile is built and its receipt says it finished", () => {
      expect(answeredLine({ placed: undefined, latest: leo, total: "£9.98", receipt: done })).toBeNull();
      expect(answeredLine({ placed: "answer-2", latest: leo, total: "£9.98", receipt: done })).toBeNull();
      expect(answeredLine({ placed: "answer-1", latest: { ...leo, empty: true }, receipt: done })).toBeNull();
      expect(answeredLine({ placed: "answer-1", latest: null, receipt: done })).toBeNull();
      expect(answeredLine({ placed: "answer-1", latest: leo, receipt: null })).toBeNull();
      expect(answeredLine({ placed: "answer-1", latest: leo, receipt: r("r2", ["place_widget"], { status: "cancelled" }) })).toBeNull();
      expect(answeredLine({ placed: "answer-1", latest: leo, receipt: startedReceipt({ runId: "r3", threadId: "t1", agentId: "spotter", startedAt: 2 }) })).toBeNull();
      // a receipt from an earlier run in the chat isn't this run's
      expect(answeredLine({ placed: "answer-1", latest: leo, total: "£9.98", receipt: done, runId: "r9" })).toBeNull();
      expect(answeredLine({ placed: "answer-1", latest: leo, total: "£9.98", receipt: done, runId: "r1" })).toBe("Chart added: What Leo spent on games, £9.98.");
    });
    it("never says the Fair price tile was added when its price checks didn't load", () => {
      const fair = { ...leo, type: "fair-price", title: "Fair prices" };
      expect(answeredLine({ placed: "answer-1", latest: fair, line: FAIR_FAILED, receipt: done })).toBeNull();
      expect(answeredLine({ placed: "answer-1", latest: fair, line: null, receipt: done })).toBeNull();
    });
  });

  it("lists what the run did from its receipt, most calls first, in plain words, at most four", () => {
    const rc = r("r1", []);
    rc.tools = [
      { name: "place_widget", calls: 1, ms: 1, failed: 0, access: "board" },
      { name: "delegate_to", calls: 2, ms: 1, failed: 0, access: "chat" },
      { name: "configure_widget", calls: 3, ms: 1, failed: 1, access: "board" },
      { name: "execute_query", calls: 1, ms: 1, failed: 0, access: "read" },
      { name: "view_schema", calls: 1, ms: 1, failed: 0, access: "read" },
      { name: "mystery", calls: 5, ms: 1, failed: 0, access: "unknown" },
      { name: "complete_task", calls: 6, ms: 1, failed: 0, access: "chat" },
      { name: "rename_thread", calls: 6, ms: 1, failed: 0, access: "chat" },
    ];
    expect(receiptSteps(rc)).toEqual([
      { what: "Set up a widget", times: 3 },
      { what: "Handed work to a helper", times: 2 },
      { what: "Placed an empty tile", times: 1 },
      { what: "Counted up the payments", times: 1 },
    ]);
    expect(receiptSteps(r("r2", []))).toEqual([]);
  });

  it("names who built it: Spotter, then each helper once", () => {
    expect(builtBy(r("r1", [], { helpers: ["widget", "data", "widget"] }))).toEqual(["Spotter", "Widget", "Data"]);
  });

  it("suggests follow up questions that aren't the one just answered", () => {
    const starters = [
      { label: "Did we pay fair prices this month?", prompt: "fair" },
      { label: "What did Leo spend on games?", prompt: "games" },
      { label: "Where did the money go?", prompt: "where" },
      { label: "Why was Gran stopped?", prompt: "gran" },
      { label: "Write this week's brief", prompt: "brief" },
    ];
    expect(followUps(starters, "What Leo spent on games").map((s) => s.prompt)).toEqual(["fair", "where", "gran"]);
    expect(followUps(starters, "Fair prices this month").map((s) => s.prompt)).toEqual(["games", "where", "gran"]);
  });

  it("goes when the last answer comes off the page", () => {
    const s = {
      pages: [
        {
          id: "page-answers",
          name: "Answers",
          widgets: { "answer-1": { type: "bar-chart-grouped" }, [SUMMARY_ID]: { type: SUMMARY_TYPE, dataMapping: {} } },
          widgetLayout: { "answer-1": { xTrack: 0, yTrack: 0, xSpan: 16, ySpan: 28 }, [SUMMARY_ID]: { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 28 } },
        },
      ],
      selectedPageId: "page-answers",
    } as never;
    const page = (dropEmptyAnswers(s).state as unknown as { pages: Array<{ widgets: object; widgetLayout: object }> }).pages[0]!;
    expect(page.widgets).toEqual({});
    expect(page.widgetLayout).toEqual({});
  });

  it("moves the next answer up into the newest spot when the newest comes off", () => {
    const set = { valueKey: [{ id: "payments.amount" }] };
    const s = {
      pages: [
        {
          id: "page-answers",
          name: "Answers",
          widgets: { "answer-2": { type: "bar-chart-grouped" }, "answer-1": { type: "bar-chart-grouped", dataMapping: set }, [SUMMARY_ID]: { type: SUMMARY_TYPE, dataMapping: {} } },
          widgetLayout: { "answer-2": { xTrack: 0, yTrack: 0, xSpan: 16, ySpan: 30 }, [SUMMARY_ID]: { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 30 }, "answer-1": { xTrack: 0, yTrack: 30, xSpan: 12, ySpan: 14 } },
        },
      ],
      selectedPageId: "page-answers",
    } as never;
    const page = (dropEmptyAnswers(s).state as unknown as { pages: Array<{ widgetLayout: Record<string, unknown> }> }).pages[0]!;
    expect(page.widgetLayout["answer-1"]).toEqual({ xTrack: 0, yTrack: 0, xSpan: 16, ySpan: 30 });
    expect(page.widgetLayout[SUMMARY_ID]).toEqual({ xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 30 });
  });
});
