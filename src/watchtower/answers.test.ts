import { describe, expect, it } from "vitest";
import { ANSWER_COLOURS, dropEmptyAnswers, isEmptyAnswer, moneyFieldsOf, polishChart } from "./answers";

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
    expect(Object.keys(page.widgets)).toEqual(["answer-1"]);
    expect(page.widgetLayout["answer-1"]!.yTrack).toBe(0);
  });

  it("returns the same board when every answer tile is set up", () => {
    const s = board({ "answer-1": { type: "bar-chart-grouped", dataMapping: byShop } });
    expect(dropEmptyAnswers(s)).toEqual({ state: s, removed: [] });
  });
});
