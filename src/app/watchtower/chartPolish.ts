// Hands every chart AG Studio draws to Spotter's polishChart (src/watchtower/answers.ts) on its way to AG
// Charts: answer tiles get neutral colours, money axes get the currency. Studio builds a chart's options
// fresh on every refresh and passes them to AgCharts.create, then chart.update, with the widget as
// `context`; a widget's saved format can't carry colours or an axis format, so this is the one place to do
// it. ag-charts-enterprise is the copy Studio itself depends on (14.2), so both import the same AgCharts.
// TODO(AG Studio): drop this if Studio gets per widget palettes or axis number formats.
import { AgCharts } from "ag-charts-enterprise";
import { answerTotal, polishChart, type MoneyFields, type TopRow } from "@/watchtower/answers";

let money: MoneyFields | null = null;
let installed = false;
// What each answer tile says, from the rows it last showed: a chart's total ("£9.98") and line, or the line
// a ready made tile published (the Fair price headline, its filters applied), for the answer card.
const totals = new Map<string, { text?: string; line: string | null; top: TopRow[] }>();
const listeners = new Set<() => void>();
const changed = () => queueMicrotask(() => listeners.forEach((l) => l()));

export function answerTotalFor(widgetId: string): string | undefined {
  return totals.get(widgetId)?.text;
}
/** The tile's one line answer ("Biggest: TuneBox, £6.00 of £9.99", or the Fair price headline). */
export function answerLineFor(widgetId: string): string | null {
  return totals.get(widgetId)?.line ?? null;
}
/** The biggest rows behind the answer (the same array until they change, so the card doesn't redraw for nothing). */
export function answerTopFor(widgetId: string): readonly TopRow[] | undefined {
  return totals.get(widgetId)?.top;
}
const sameRows = (a: readonly TopRow[] | undefined, b: readonly TopRow[]) => !!a && a.length === b.length && a.every((r, i) => r.label === b[i]!.label && r.value === b[i]!.value);
export function onAnswerTotals(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** A ready made answer tile (fair-price) publishes its own headline, so the card says what the tile says. */
export function noteAnswerLine(widgetId: string, line: string, top: TopRow[] = []) {
  if (!widgetId.startsWith("answer-")) return;
  const seen = totals.get(widgetId);
  if (seen && seen.text === undefined && seen.line === line && sameRows(seen.top, top)) return;
  totals.set(widgetId, { line, top });
  changed();
}
const noteTotal = (options: object) => {
  if (!money) return;
  const t = answerTotal(options, money);
  if (!t) {
    // An answer chart drawn with no rows (a new filter or mapping) drops its old total and line.
    const id = (options as { context?: { params?: { widgetId?: unknown } } }).context?.params?.widgetId;
    if (typeof id === "string" && id.startsWith("answer-") && totals.delete(id)) changed();
    return;
  }
  const seen = totals.get(t.widgetId);
  if (seen && seen.text === t.text && seen.line === t.line && sameRows(seen.top, t.top)) return;
  totals.set(t.widgetId, { text: t.text, line: t.line, top: t.top });
  changed();
};
/** The board's currency fields; set before Studio draws, and again when the data changes. */
export function setChartMoney(next: MoneyFields) {
  money = next;
}

const polish = <T extends object>(options: T): T => {
  if (!money) return options;
  try {
    noteTotal(options);
    return polishChart(options, money);
  } catch (e) {
    // Polish is cosmetic: a chart drawn in Studio's own colours beats no chart.
    console.error("[watchtower] couldn't polish a chart, drawing it as Studio built it:", e);
    return options;
  }
};

/** Installs once per page load. */
export function installChartPolish() {
  if (installed) return;
  installed = true;
  const create = AgCharts.create.bind(AgCharts);
  AgCharts.create = ((options: object, ...rest: unknown[]) => {
    const chart = (create as (o: object, ...r: unknown[]) => { update(o: object): Promise<void> })(polish(options), ...rest);
    const update = chart.update.bind(chart);
    chart.update = (next: object) => update(polish(next));
    return chart;
  }) as typeof AgCharts.create;
}
