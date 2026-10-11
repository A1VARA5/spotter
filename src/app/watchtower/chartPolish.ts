// Hands every chart AG Studio draws to Spotter's polishChart (src/watchtower/answers.ts) on its way to AG
// Charts: answer tiles get neutral colours, money axes get the currency. Studio builds a chart's options
// fresh on every refresh and passes them to AgCharts.create, then chart.update, with the widget as
// `context`; a widget's saved format can't carry colours or an axis format, so this is the one place to do
// it. ag-charts-enterprise is the copy Studio itself depends on (14.2), so both import the same AgCharts.
// TODO(AG Studio): drop this if Studio gets per widget palettes or axis number formats.
import { AgCharts } from "ag-charts-enterprise";
import { answerTotal, polishChart, type MoneyFields } from "@/watchtower/answers";

let money: MoneyFields | null = null;
let installed = false;
// What each answer chart adds up to, from the rows it was last drawn with ("£9.98"), for the Answers line.
const totals = new Map<string, string>();
const listeners = new Set<() => void>();

export function answerTotalFor(widgetId: string): string | undefined {
  return totals.get(widgetId);
}
export function onAnswerTotals(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const noteTotal = (options: object) => {
  if (!money) return;
  const t = answerTotal(options, money);
  if (!t || totals.get(t.widgetId) === t.text) return;
  totals.set(t.widgetId, t.text);
  queueMicrotask(() => listeners.forEach((l) => l()));
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
