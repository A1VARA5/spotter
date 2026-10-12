// Answer charts, polished by Spotter's code whoever set them up.
// AG Studio has one chart palette for the whole board, and Watchtower's is the outcome palette (Stopped red
// first, see Studio.tsx themeFor). That's right for charts about outcomes, wrong for answers ("what Leo spent
// on games" in Stopped red). Studio also formats tooltips with a field's currency but not the value axis
// (0, 2, 4...). A widget's saved format can't carry either: Studio rebuilds it from its own form fields,
// which have no colours or axis format. So polishChart works on the AG Charts options Studio builds for each
// chart on every refresh (chartPolish.ts hands them over): answer tiles get a neutral palette of their own,
// and every chart that adds up money gets its value axis in pounds.
import type { AgReportState } from "ag-studio";
import { ANSWERS_PAGE, arrangeAnswersIn, isEmptyAnswer } from "./pages";
import { TOOL_WORDS, helperName, toolWords, type Receipt } from "./receipt";

/**
 * Neutral answer colours from the design tokens: a tint of the protect blue (3.3:1 on white, ink text on it
 * 4.9:1), ink-2 slate, soft tints of the go and hold colours, a light slate and ink. Neighbours sit well
 * apart in a donut. No red.
 */
export const ANSWER_COLOURS = ["#6F8BD8", "#4A5866", "#7DB89F", "#E8C35A", "#B7C0C9", "#17212B"];
const INK = "#17212B";
const OUTCOME_FIELDS = new Set(["payments.outcome", "payments.outcomeText"]);
const SLIM_UNDER = 8;
const SLIM_PER_BAR = 0.12;
/** Up to this many bars in all are drawn SLIM_PX wide, whatever the tile size. */
const SLIM_FIXED_UPTO = 4;
const SLIM_PX = 28;
const TOP_ROWS = 3;

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
  // Answers show their numbers at the end of each bar: inside it, or just past it when the bar is too short.
  // Ink reads on the first answer colour and on the page. Studio formats series labels with the field's format (£).
  // One or a few bars would each fill their whole band (one bar for one shop was a block across the board),
  // so up to four bars in all (one shop, or one shop split by a legend) are drawn at a fixed slim width on
  // any tile size (a share of the band still came out 53 px thick on a tall 1920 tile), and a single series
  // of five to seven bars at 12% of the band per bar, more as bars add up. Never both: a ratio scales the width.
  if (params.widgetId.startsWith("answer-") && Array.isArray(o.series)) {
    const series = o.series as Array<Record<string, unknown>>;
    const rows = Array.isArray(o.data) ? o.data.length : 0;
    const barSeries = series.filter((s) => s?.type === "bar").length;
    const fixed = rows > 0 && barSeries > 0 && rows * barSeries <= SLIM_FIXED_UPTO;
    const slim = !fixed && series.length === 1 && rows > 0 && rows < SLIM_UNDER ? Math.round(SLIM_PER_BAR * rows * 100) / 100 : undefined;
    next.series = series.map((s) =>
      s?.type === "bar"
        ? { ...s, label: { ...(s.label as object | undefined), enabled: true, color: INK, placement: ["inside-end", "outside-end"] }, ...(fixed ? { width: SLIM_PX } : slim ? { widthRatio: slim } : {}) }
        : s,
    );
  }
  const sumsMoney = refs(m, "valueKey").some((r) => money.fields.has(fieldOf(r)) && !isCount(r));
  if (sumsMoney && o.axes) {
    next.axes = Object.fromEntries(Object.entries(o.axes).map(([k, a]) => [k, a?.type === "number" ? { ...a, label: { ...a.label, format: `${money.symbol},~f` } } : a]));
  }
  return next as T;
}

/**
 * What an answer chart adds up to, from the very rows it draws, for the line above the Answers page
 * ("£9.98"). Money in the board's currency, counts as whole numbers. Null for other charts or no rows.
 */
/** group "too-cheap": a fair price row the card lists under its own "Too cheap to be real" line. */
export type TopRow = { label: string; value: string; group?: "too-cheap" };
export function answerTotal(options: object, money: MoneyFields): { widgetId: string; text: string; line: string | null; top: TopRow[] } | null {
  const o = options as ChartOptions & { data?: unknown; series?: unknown };
  const params = o.context?.params;
  if (!params || typeof params.widgetId !== "string" || !params.widgetId.startsWith("answer-")) return null;
  const rows = Array.isArray(o.data) ? (o.data as Array<Record<string, unknown>>) : [];
  const series = Array.isArray(o.series) ? (o.series as Array<Record<string, unknown>>) : [];
  const keys = series.map((s) => s?.yKey ?? s?.angleKey).filter((k): k is string => typeof k === "string");
  if (!rows.length || !keys.length) return null;
  const rowSum = (row: Record<string, unknown>) => keys.reduce((t, k) => t + (typeof row[k] === "number" && Number.isFinite(row[k]) ? (row[k] as number) : 0), 0);
  const total = rows.reduce((t, row) => t + rowSum(row), 0);
  const isMoney = refs(params.dataMapping, "valueKey").some((r) => money.fields.has(fieldOf(r)) && !isCount(r));
  const fmt = (n: number) => (isMoney ? `${money.symbol}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Math.round(n).toLocaleString("en-GB"));
  const text = fmt(total);
  // The one line answer for the card: what the only bar is, or the biggest bar and its share. Only from a
  // plain text or number label: anything else (a date object, a missing key) gets no line rather than a guess.
  const labelKey = [series[0]?.xKey, series[0]?.calloutLabelKey, series[0]?.sectorLabelKey, series[0]?.legendItemKey].find((k): k is string => typeof k === "string");
  const labelOf = (row: Record<string, unknown>) => {
    const v = labelKey ? row[labelKey] : undefined;
    // A number on the label axis (an amount the model put there) is not a name: printing it gave "Biggest: 217.25".
    return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  };
  const top = rows.reduce((best, row) => (rowSum(row) > rowSum(best) ? row : best), rows[0]!);
  const name = labelOf(top);
  const negative = rows.some((row) => rowSum(row) < 0);
  const line = !name || negative ? null : rows.length === 1 ? `All of it: ${name}` : `Biggest: ${name}, ${fmt(rowSum(top))} of ${text}`;
  // The biggest rows behind the chart, for the card: only rows with a plain label, never a guessed one.
  const biggest = [...rows]
    .sort((x, y) => rowSum(y) - rowSum(x))
    .filter((row) => labelOf(row) !== "")
    .slice(0, TOP_ROWS)
    .map((row) => ({ label: labelOf(row), value: fmt(rowSum(row)) }));
  return { widgetId: params.widgetId, text, line, top: biggest };
}

/**
 * The answer card's one line, for every kind of answer: the line the tile itself published from the rows it
 * shows (a chart's biggest bar, the Fair price tile's headline, filters and all), or where the answer is.
 * A table never takes a line: a reused tile can change type under the same id. Never blank.
 */
export function cardLine(a: { type: string; line?: string | null }): string {
  if (a.type === "grid" || a.type === "pivot-grid") return "Every row is in the table beside this card.";
  if (a.line) return a.line;
  if (a.type === "fair-price") return "The Fair price tile beside this card has the answer.";
  return "The chart beside this card shows the answer.";
}

export { isEmptyAnswer };

type Latest = { pageId: string; widgetId: string; title: string; empty: boolean } | null;
export type AnswerLine =
  | { kind: "building"; pageId: string; title: string }
  | { kind: "unfinished"; pageId: string; title: string }
  | { kind: "answer"; pageId: string; widgetId: string; title: string }
  | null;

/**
 * The line above the Answers page. "Building your chart" only while a run is live in this tab. An empty
 * newest tile with nothing running was cut off (the tab was closed, reloaded or left mid run, or Stop was
 * pressed): it says it didn't finish and offers Ask again, which sets the same tile up (placeAnswer reuses
 * an empty tile with the same title). The next finished run's tidy takes any leftover empty tile off.
 */
export function answerLine(latest: Latest, running: boolean): AnswerLine {
  if (!latest) return null;
  if (latest.empty) return { kind: running ? "building" : "unfinished", pageId: latest.pageId, title: latest.title };
  return { kind: "answer", pageId: latest.pageId, widgetId: latest.widgetId, title: latest.title };
}

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
    const widgets = Object.fromEntries(Object.entries(p.widgets ?? {}).filter(([id]) => !gone.includes(id)));
    const widgetLayout = Object.fromEntries(Object.entries(p.widgetLayout ?? {}).filter(([id]) => !gone.includes(id)));
    return { ...p, widgets, widgetLayout };
  });
  if (!removed.length) return { state, removed };
  // The answers left close up: the next one moves into the newest spot beside the card (no answers, no card).
  return { state: arrangeAnswersIn({ ...state, pages: next } as unknown as AgReportState), removed };
}

/**
 * The receipt for the newest answer on the summary card: the newest finished run that placed a tile. A run
 * that only chatted, was stopped, was cut off or whose place_widget failed didn't build the answer, so it's skipped.
 * Known gap: if a run's tile was taken off as empty, the older answer moved up still shows that run's receipt.
 */
export function answerReceipt(receipts: readonly Receipt[]): Receipt | null {
  return receipts.find((r) => r.status === "ok" && r.tools.some((t) => t.name === "place_widget" && t.calls > t.failed)) ?? null;
}

/** What the Fair price tile says when its price checks didn't load. */
export const FAIR_FAILED = "The price checks didn't load. Reload the page.";

/**
 * The chat's plain line for a run that built its answer but wrote no reply (R7-N1): "Chart added: What Leo
 * spent on games, £9.98." Only when the tile this run placed is the newest answer, it's built, and the run's
 * receipt says it finished with that tile placed. Otherwise null, and the chat keeps "didn't finish".
 */
export function answeredLine(o: {
  placed: string | undefined;
  latest: { widgetId: string; type: string; title: string; empty: boolean } | null;
  total?: string;
  /** The line the tile published (the Fair price headline, or FAIR_FAILED when its checks didn't load). */
  line?: string | null;
  receipt: Receipt | null;
  /** The chat's current run: a receipt from an earlier run in the same chat doesn't count. */
  runId?: string;
}): string | null {
  const { placed, latest, receipt } = o;
  if (!placed || !latest || latest.empty || latest.widgetId !== placed || !receipt || answerReceipt([receipt]) !== receipt) return null;
  if (o.runId !== undefined && receipt.runId !== o.runId) return null;
  // The Fair price tile is never empty (it fills itself), so it counts only once it has said its headline.
  if (latest.type === "fair-price" && (!o.line || o.line === FAIR_FAILED)) return null;
  const title = latest.title.replace(/[\s.?!]+$/, "");
  if (latest.type === "grid" || latest.type === "pivot-grid") return title ? `Table added: ${title}.` : "Table added to the Answers page.";
  if (latest.type === "fair-price") return title ? `Fair price tile added: ${title}.` : "Fair price tile added to the Answers page.";
  if (!title) return "Chart added to the Answers page.";
  return o.total ? `Chart added: ${title}, ${o.total}.` : `Chart added: ${title}.`;
}

/** Calls that don't change or read anything the family cares about (a helper reporting back, naming the chat). */
const BOOKKEEPING = new Set(["complete_task", "rename_thread"]);
/** What a run did, from its receipt, in the receipt's own plain words: most calls first, tools Spotter knows only, at most four. */
export function receiptSteps(r: Pick<Receipt, "tools">, max = 4): Array<{ what: string; times: number }> {
  return r.tools
    .filter((t) => t.access !== "unknown" && t.calls > 0 && !BOOKKEEPING.has(t.name) && Object.prototype.hasOwnProperty.call(TOOL_WORDS, t.name))
    .map((t, i) => ({ what: toolWords(t.name), times: t.calls, i }))
    .sort((a, b) => b.times - a.times || a.i - b.i)
    .slice(0, max)
    .map(({ what, times }) => ({ what, times }));
}

/** Who built an answer, from its receipt: the agent that led, then each helper it handed work to, once. */
export function builtBy(r: Pick<Receipt, "agentId" | "helpers">): string[] {
  return [...new Set([r.agentId, ...r.helpers].map(helperName))];
}

const COMMON = new Set(["what", "when", "where", "which", "this", "that", "with", "from", "show", "your", "have", "does", "were", "much", "about"]);
const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !COMMON.has(w)));

/** Questions to ask next on the card: the board's own starters, minus any about the answer just given. */
export function followUps<T extends { label: string }>(starters: readonly T[], title: string, max = 3): T[] {
  const asked = words(title);
  return starters
    .filter((s) => {
      const mine = words(s.label);
      const shared = [...mine].filter((w) => asked.has(w)).length;
      return shared === 0 || shared < Math.min(2, mine.size, asked.size);
    })
    .slice(0, max);
}
