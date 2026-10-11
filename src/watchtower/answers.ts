// Answer charts, polished by Spotter's code whoever set them up.
// AG Studio has one chart palette for the whole board, and Watchtower's is the outcome palette (Stopped red
// first, see Studio.tsx themeFor). That's right for charts about outcomes, wrong for answers ("what Leo spent
// on games" in Stopped red). Studio also formats tooltips with a field's currency but not the value axis
// (0, 2, 4...). A widget's saved format can't carry either: Studio rebuilds it from its own form fields,
// which have no colours or axis format. So polishChart works on the AG Charts options Studio builds for each
// chart on every refresh (chartPolish.ts hands them over): answer tiles get a neutral palette of their own,
// and every chart that adds up money gets its value axis in pounds.
import type { AgReportState } from "ag-studio";
import { ANSWERS_PAGE, isEmptyAnswer } from "./pages";

/**
 * Neutral answer colours from the design tokens: ink-2 slate, soft tints of the protect, go and hold
 * colours, a light slate and ink. Each sits well apart from its neighbours in a donut. No red.
 */
export const ANSWER_COLOURS = ["#4A5866", "#8FA6E4", "#7DB89F", "#E8C35A", "#B7C0C9", "#17212B"];
const OUTCOME_FIELDS = new Set(["payments.outcome", "payments.outcomeText"]);

/** A field in a data mapping: saved boards say `id`, the hydrated fields Studio hands a chart say `fieldId`. */
type Ref = { id?: string; fieldId?: string; aggregation?: string };
const fieldOf = (r: Ref) => r.id ?? r.fieldId ?? "";
type Mapping = Record<string, Ref[] | undefined>;
type Widget = { type?: string; dataMapping?: Mapping };
type Box = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
type Page = { id: string; name?: string; widgets?: Record<string, Widget>; widgetLayout?: Record<string, Box> };
export type MoneyFields = { fields: Set<string>; symbol: string };

/** The board's currency fields ("payments.amount") and their symbol, from the data definition. */
export function moneyFieldsOf(sources: ReadonlyArray<{ id: string; fields: ReadonlyArray<{ id: string; format?: string; formatOptions?: { format?: string } }> }>): MoneyFields {
  const fields = new Set<string>();
  let symbol = "£";
  for (const src of sources) {
    for (const f of src.fields) {
      if (f.format !== "currencyFormat") continue;
      fields.add(`${src.id}.${f.id}`);
      const s = f.formatOptions?.format?.match(/^[$€£¥]/)?.[0];
      if (s) symbol = s;
    }
  }
  return { fields, symbol };
}

const refs = (m: Mapping | undefined, key: string) => m?.[key] ?? [];
const isCount = (r: Ref) => /count/i.test(r.aggregation ?? "");

type Axis = { type?: string; label?: Record<string, unknown> } & Record<string, unknown>;
type ChartOptions = {
  context?: { params?: { widgetId?: unknown; dataMapping?: Mapping } };
  theme?: Record<string, unknown> | string;
  axes?: Record<string, Axis>;
} & Record<string, unknown>;

/**
 * One chart's AG Charts options with Spotter's polish: an answer tile (id answer-N) gets the neutral palette
 * unless it is about outcomes, and a value axis over a money field is labelled in the board's currency.
 * Anything that isn't a Studio widget chart comes back untouched.
 */
export function polishChart<T extends object>(options: T, money: MoneyFields): T {
  const o = options as ChartOptions;
  const params = o.context?.params;
  if (!params || typeof params.widgetId !== "string") return options;
  const m = params.dataMapping;
  const next: ChartOptions = { ...o };
  const byOutcome = [...refs(m, "categoryKey"), ...refs(m, "legendKey")].some((r) => OUTCOME_FIELDS.has(fieldOf(r)));
  if (params.widgetId.startsWith("answer-") && !byOutcome && o.theme && typeof o.theme === "object") {
    next.theme = { ...o.theme, palette: { fills: ANSWER_COLOURS, strokes: ANSWER_COLOURS } };
  }
  const sumsMoney = refs(m, "valueKey").some((r) => money.fields.has(fieldOf(r)) && !isCount(r));
  if (sumsMoney && o.axes) {
    next.axes = Object.fromEntries(Object.entries(o.axes).map(([k, a]) => [k, a?.type === "number" ? { ...a, label: { ...a.label, format: `${money.symbol},~f` } } : a]));
  }
  return next as T;
}

export { isEmptyAnswer };

/**
 * Takes empty answer tiles off the Answers page (the widget agent failed or did nothing) and moves the
 * tiles below up into the gap. Returns the same board and no ids when there was nothing to take off.
 */
export function dropEmptyAnswers(state: AgReportState): { state: AgReportState; removed: string[] } {
  const pages = (state.pages as unknown as Page[]) ?? [];
  const removed: string[] = [];
  const next = pages.map((p) => {
    if (p.name !== ANSWERS_PAGE) return p;
    const gone = Object.entries(p.widgets ?? {}).filter(([id, w]) => id.startsWith("answer-") && isEmptyAnswer(w)).map(([id]) => id);
    if (!gone.length) return p;
    removed.push(...gone);
    const layout = p.widgetLayout ?? {};
    const holes = gone.map((id) => layout[id]).filter((b): b is Box => !!b);
    const widgets = Object.fromEntries(Object.entries(p.widgets ?? {}).filter(([id]) => !gone.includes(id)));
    const widgetLayout = Object.fromEntries(
      Object.entries(layout)
        .filter(([id]) => !gone.includes(id))
        // A full width hole above a tile moves it up by the hole's height.
        .map(([id, b]) => [id, { ...b, yTrack: b.yTrack - holes.filter((h) => h.xSpan >= 24 && h.yTrack < b.yTrack).reduce((n, h) => n + h.ySpan, 0) }]),
    );
    return { ...p, widgets, widgetLayout };
  });
  return removed.length ? { state: { ...state, pages: next } as unknown as AgReportState, removed } : { state, removed };
}
