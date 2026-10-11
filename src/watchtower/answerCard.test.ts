// Round 6: the answer card had no one line answer for the fair price question (a 400 px empty middle), and
// a single bar answer ("What Leo spent on games", one shop) drew as one huge block across the board.
import { describe, expect, it } from "vitest";
import { answerTotal, cardLine, moneyFieldsOf, polishChart } from "./answers";

const money = moneyFieldsOf([{ id: "payments", fields: [{ id: "amount", format: "currencyFormat", formatOptions: { format: "£#,##0.00" } }] }]);
const byShop = { categoryKey: [{ id: "payments.payee" }], valueKey: [{ id: "payments.amount", aggregation: "sum" }] };
const counts = { categoryKey: [{ id: "payments.who" }], valueKey: [{ id: "payments.id", aggregation: "count" }] };
const chart = (widgetId: string, rows: Array<Record<string, unknown>>, series: Array<Record<string, unknown>> = [{ type: "bar", xKey: "p", yKey: "v" }], dataMapping: object = byShop) => ({
  context: { params: { widgetId, dataMapping } },
  theme: { palette: { fills: ["#BE3328"], strokes: ["#BE3328"] } },
  data: rows,
  series,
});

describe("an answer chart's one line answer", () => {
  it("names the one bar when there is only one", () => {
    expect(answerTotal(chart("answer-1", [{ p: "BlockWorld", v: 9.98 }]), money)).toEqual({ widgetId: "answer-1", text: "£9.98", line: "All of it: BlockWorld" });
  });

  it("names the biggest bar and its share when there are several", () => {
    const t = answerTotal(chart("answer-1", [{ p: "BlockWorld", v: 3.99 }, { p: "TuneBox", v: 6 }]), money);
    expect(t).toEqual({ widgetId: "answer-1", text: "£9.99", line: "Biggest: TuneBox, £6.00 of £9.99" });
  });

  it("counts plainly when the chart counts, and reads a donut's labels", () => {
    expect(answerTotal(chart("answer-2", [{ p: "Gran", v: 4 }, { p: "Leo", v: 2 }], undefined, counts), money)?.line).toBe("Biggest: Gran, 4 of 6");
    expect(answerTotal(chart("answer-3", [{ s: "Gran", v: 10 }, { s: "Leo", v: 5.5 }], [{ type: "donut", angleKey: "v", calloutLabelKey: "s" }]), money)?.line).toBe("Biggest: Gran, £10.00 of £15.50");
  });

  it("has no line when it can't tell what a bar stands for, rather than guess", () => {
    expect(answerTotal(chart("answer-1", [{ v: 9.98 }], [{ type: "bar", yKey: "v" }]), money)?.line).toBeNull();
  });
});

describe("the card's one line, for every kind of answer", () => {
  it("uses the line the tile itself published (chart or fair price), or says where the answer is", () => {
    expect(cardLine({ type: "bar-chart-grouped", line: "All of it: BlockWorld" })).toBe("All of it: BlockWorld");
    expect(cardLine({ type: "fair-price", line: "Your agent paid £8.50 more than the cheapest real shops on 2 items this month" })).toBe(
      "Your agent paid £8.50 more than the cheapest real shops on 2 items this month",
    );
    expect(cardLine({ type: "fair-price" })).toBe("The Fair price tile beside this card has the answer.");
    expect(cardLine({ type: "donut-chart" })).toBe("The chart beside this card shows the answer.");
  });

  it("never lets a table say an old chart's line (a reused tile changed type)", () => {
    expect(cardLine({ type: "grid", line: "Biggest: TuneBox, £6.00 of £9.99" })).toBe("Every row is in the table beside this card.");
    expect(cardLine({ type: "pivot-grid" })).toBe("Every row is in the table beside this card.");
  });

  it("has no line when a bar is negative (a refund), so the biggest can't exceed the total", () => {
    expect(answerTotal(chart("answer-1", [{ p: "a", v: 10 }, { p: "b", v: -5 }]), money)?.line).toBeNull();
  });
});

describe("bar thickness on answer charts", () => {
  const bars = (o: object) => (o as { series: Array<{ widthRatio?: number }> }).series.map((s) => s.widthRatio);
  it("keeps one or a few bars slim instead of one block across the board", () => {
    const one = bars(polishChart(chart("answer-1", [{ p: "BlockWorld", v: 9.98 }]), money))[0]!;
    expect(one).toBeLessThanOrEqual(0.2);
    const two = bars(polishChart(chart("answer-1", [{ p: "a", v: 1 }, { p: "b", v: 2 }]), money))[0]!;
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThanOrEqual(0.4);
  });

  it("leaves many bars, grouped bars and the board's own charts as Studio drew them", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ p: `s${i}`, v: i + 1 }));
    expect(bars(polishChart(chart("answer-1", many), money))[0]).toBeUndefined();
    expect(bars(polishChart(chart("answer-1", [{ p: "a", v: 1, w: 2 }], [{ type: "bar", xKey: "p", yKey: "v" }, { type: "bar", xKey: "p", yKey: "w" }]), money))).toEqual([undefined, undefined]);
    expect(bars(polishChart(chart("people", [{ p: "a", v: 1 }]), money))[0]).toBeUndefined();
  });
});
