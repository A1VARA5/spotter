// AG Studio 3.0 keeps several pages in its state but shows no way to move between them, so Watchtower
// draws its own page tabs. Page names are ours (Studio's page state has no name), so we remember them and
// put them back before saving in case Studio leaves them out.
import type { AgReportState } from "ag-studio";

type Page = { id: string; name?: string };
export type PageTab = { id: string; name: string; removable: boolean };

const pagesIn = (s: AgReportState) => (s.pages as unknown as Page[]) ?? [];

export function namesOf(s: AgReportState): Record<string, string> {
  return Object.fromEntries(pagesIn(s).filter((p) => typeof p.name === "string" && p.name).map((p) => [p.id, p.name!]));
}

export function pageTabs(s: AgReportState, names: Record<string, string>): { tabs: PageTab[]; selected: string } {
  const pages = pagesIn(s);
  return {
    tabs: pages.map((p, i) => ({ id: p.id, name: p.name || names[p.id] || `Page ${i + 1}`, removable: i > 0 })),
    selected: s.selectedPageId,
  };
}

export function withNames(s: AgReportState, names: Record<string, string>): AgReportState {
  return { ...s, pages: pagesIn(s).map((p) => (p.name || !names[p.id] ? p : { ...p, name: names[p.id] })) } as unknown as AgReportState;
}

export function removePage(s: AgReportState, id: string): AgReportState {
  const pages = pagesIn(s);
  if (pages.length < 2) return s;
  const rest = pages.filter((p) => p.id !== id);
  return { ...s, pages: rest, selectedPageId: s.selectedPageId === id ? rest[0]!.id : s.selectedPageId } as unknown as AgReportState;
}

const MAX_NAME = 40;
// Zero width and bidi marks vanish; anything else that isn't a letter, digit or plain punctuation becomes a space.
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;
const NOT_PLAIN = /[^\p{L}\p{N} £.,'!?:&-]/gu;

/**
 * A new empty page with a name an agent chose (the add_page tool), selected so the family sees it fill
 * in. A page with the same name is reused, so a retried tool call doesn't leave two. Throws on an empty name.
 */
export function addPage(s: AgReportState, rawName: string): { state: AgReportState; pageId: string } {
  const name = rawName.replace(INVISIBLE, "").replace(NOT_PLAIN, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();
  if (!/[\p{L}\p{N}]/u.test(name)) throw new Error("The page needs a name with letters or numbers in it.");
  const pages = pagesIn(s);
  const same = pages.find((p) => p.name?.trim().toLowerCase() === name.toLowerCase());
  if (same) return { state: { ...s, selectedPageId: same.id } as AgReportState, pageId: same.id };
  const slug = `page-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "new"}`;
  const taken = new Set(pages.map((p) => p.id));
  let pageId = slug;
  for (let n = 2; taken.has(pageId); n++) pageId = `${slug}-${n}`;
  const page = { id: pageId, name, widgets: {}, widgetLayout: {} };
  return { state: { ...s, pages: [...pages, page], selectedPageId: pageId } as unknown as AgReportState, pageId };
}

type Box = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };

/** Spotter's text tiles: their content gets shorter as the board gets wider, unlike a chart's. */
const TEXT_TILES = new Set(["watch-alerts", "fair-price", "money-mid-air", "price-watches", "scam-radar"]);
/**
 * How much of its height a text tile row keeps at a window width (rows are a fixed pixel height in Studio).
 * Tall rows (the alerts, fair price and money in mid air row) shrink most; shorter rows of lists a little.
 * Measured on the demo board at 1920 and 2560 so the fullest tile still fits: the fair price tile needs 23 rows
 * at 1920 and 19 at 2560 (rows are about 16 px), so the tall row keeps 24 and 20, one spare each.
 */
export const wideFactor = (width: number, rows = 28) => (width >= 2300 ? (rows >= 25 ? 0.72 : 0.8) : width >= 1800 ? (rows >= 25 ? 0.86 : 0.9) : 1);

export type Fitted = Record<string, { original: Record<string, Box>; fitted: Record<string, Box> }>;

/**
 * At 1920 px and wider the text tiles' rows get shorter (and every row below moves up), so the top of the
 * board isn't half empty. Only pages laid out in clean full rows are touched; the result is for showing,
 * and unfitWide puts the original back before the board is saved.
 */
export function fitWide(s: AgReportState, width: number): { state: AgReportState; fitted: Fitted } {
  if (wideFactor(width) === 1) return { state: s, fitted: {} };
  const fitted: Fitted = {};
  type Pg = Page & { widgets?: Record<string, { type?: string }>; widgetLayout?: Record<string, Box> };
  const pages = (pagesIn(s) as Pg[]).map((p) => {
    const layout = p.widgetLayout ?? {};
    const entries = Object.entries(layout);
    if (!entries.length) return p;
    const bands = [...new Set(entries.map(([, b]) => b.yTrack))].sort((a, b) => a - b);
    // Clean rows only: every tile in a row has the row's height, and each row starts where the last one ended.
    let y = 0;
    for (const start of bands) {
      const row = entries.filter(([, b]) => b.yTrack === start);
      const h = row[0]![1].ySpan;
      if (start !== y || row.some(([, b]) => b.ySpan !== h)) return p;
      y = start + h;
    }
    let shift = 0;
    let changed = false;
    const next: Record<string, Box> = {};
    for (const start of bands) {
      const row = entries.filter(([, b]) => b.yTrack === start);
      const h = row[0]![1].ySpan;
      const text = row.every(([id]) => TEXT_TILES.has(p.widgets?.[id]?.type ?? ""));
      const nh = text ? Math.max(8, Math.round(h * wideFactor(width, h))) : h;
      for (const [id, b] of row) next[id] = { ...b, yTrack: b.yTrack - shift, ySpan: nh };
      if (nh !== h) changed = true;
      shift += h - nh;
    }
    if (!changed) return p;
    fitted[p.id] = { original: layout, fitted: next };
    return { ...p, widgetLayout: next };
  });
  return { state: { ...s, pages } as unknown as AgReportState, fitted };
}

const sameBox = (a: Box | undefined, b: Box | undefined) => !!a && !!b && a.xTrack === b.xTrack && a.yTrack === b.yTrack && a.xSpan === b.xSpan && a.ySpan === b.ySpan;

/**
 * The layout to save, so the shortened rows never reach the database (and never shrink again on the next
 * load). Tiles still where fitWide put them get their original box back. Tiles someone moved or added since
 * keep their size, and their row is mapped back onto the original rows.
 */
export function unfitWide(s: AgReportState, fitted: Fitted): AgReportState {
  if (!Object.keys(fitted).length) return s;
  type Pg = Page & { widgetLayout?: Record<string, Box> };
  const pages = (pagesIn(s) as Pg[]).map((p) => {
    const f = fitted[p.id];
    if (!f || !p.widgetLayout) return p;
    // Each fitted row start and where that row started originally, top to bottom.
    const rows = [...new Map(Object.entries(f.fitted).map(([id, b]) => [b.yTrack, f.original[id]!.yTrack])).entries()].sort((a, b) => a[0] - b[0]);
    const back = (y: number) => {
      const row = [...rows].reverse().find(([fy]) => fy <= y);
      return row ? row[1] + (y - row[0]) : y;
    };
    const widgetLayout = Object.fromEntries(
      Object.entries(p.widgetLayout).map(([id, b]) => [id, sameBox(b, f.fitted[id]) ? f.original[id]! : { ...b, yTrack: back(b.yTrack) }]),
    );
    return { ...p, widgetLayout };
  });
  return { ...s, pages } as unknown as AgReportState;
}

/** Where answers to typed questions go: their own page, so the new tile is the first thing on screen. */
export const ANSWERS_PAGE = "Answers";
/** Rows an older answer gets (two to a row under the newest): room for a chart with its labels. */
export const ANSWER_SPAN = 14;
/** The newest answer and its summary card: this many rows at least, more on a tall screen (answerRows). */
export const ANSWER_TOP = 28;
const ANSWER_TOP_MAX = 64;
/** How wide the newest answer is; its summary card takes the rest of the 24 tracks. */
const ANSWER_WIDE = 16;
/** Spotter's card beside the newest answer: the question, its total, who built it, the receipt, what to ask next. */
export const SUMMARY_ID = "summary";
export const SUMMARY_TYPE = "answer-summary";

/** Rows for the newest answer and its card, from the rows the board shows at once, so one answer fills the screen. */
export const answerRows = (visibleRows: number) => Math.max(ANSWER_TOP, Math.min(ANSWER_TOP_MAX, Math.floor(visibleRows)));

type AnswersPage = Page & { widgets?: Record<string, { type?: string; dataMapping?: Record<string, unknown> }>; widgetLayout?: Record<string, Box> };
const isAnswer = (id: string) => id.startsWith("answer-");

/**
 * The Answers page laid out: the newest answer (the first in `order`, else the top left one) large at the
 * top left with the summary card beside it, older answers two to a row below, and any other tile someone
 * put there below those, full width. No answers: no card either. Pure; returns the same page when nothing moves.
 */
function arrangeAnswers(page: AnswersPage, top?: number, order?: string[]): AnswersPage {
  const widgets = { ...(page.widgets ?? {}) };
  const layout = page.widgetLayout ?? {};
  const pos = (id: string) => layout[id] ?? { xTrack: 0, yTrack: Number.MAX_SAFE_INTEGER, xSpan: 24, ySpan: ANSWER_SPAN };
  const byPlace = (a: string, b: string) => pos(a).yTrack - pos(b).yTrack || pos(a).xTrack - pos(b).xTrack || a.localeCompare(b);
  const placed = Object.keys(widgets).filter(isAnswer).sort(byPlace);
  const answers = order ? [...order.filter((id) => id in widgets), ...placed.filter((id) => !order.includes(id))] : placed;
  const others = Object.keys(widgets).filter((id) => !isAnswer(id) && id !== SUMMARY_ID).sort(byPlace);
  const rows = top ?? layout[SUMMARY_ID]?.ySpan ?? ANSWER_TOP;
  const next: Record<string, Box> = {};
  if (answers.length) {
    widgets[SUMMARY_ID] = widgets[SUMMARY_ID]?.type === SUMMARY_TYPE ? widgets[SUMMARY_ID] : { type: SUMMARY_TYPE, dataMapping: {} };
    next[answers[0]!] = { xTrack: 0, yTrack: 0, xSpan: ANSWER_WIDE, ySpan: rows };
    next[SUMMARY_ID] = { xTrack: ANSWER_WIDE, yTrack: 0, xSpan: 24 - ANSWER_WIDE, ySpan: rows };
    answers.slice(1).forEach((id, i) => (next[id] = { xTrack: (i % 2) * 12, yTrack: rows + Math.floor(i / 2) * ANSWER_SPAN, xSpan: 12, ySpan: ANSWER_SPAN }));
  } else delete widgets[SUMMARY_ID];
  // Other tiles keep their column, width and spacing; the block of them just moves below the answers.
  const y = answers.length ? rows + Math.ceil((answers.length - 1) / 2) * ANSWER_SPAN : 0;
  const placedOthers = others.filter((id) => layout[id]);
  const topOther = Math.min(...placedOthers.map((id) => layout[id]!.yTrack));
  let loose = y + Math.max(0, ...placedOthers.map((id) => layout[id]!.yTrack + layout[id]!.ySpan - topOther));
  for (const id of others) {
    const b = layout[id];
    if (b) next[id] = { ...b, yTrack: y + b.yTrack - topOther };
    else {
      next[id] = { xTrack: 0, yTrack: loose, xSpan: 24, ySpan: ANSWER_SPAN };
      loose += ANSWER_SPAN;
    }
  }
  const same =
    Object.keys(next).length === Object.keys(layout).length &&
    Object.entries(next).every(([id, b]) => sameBox(b, layout[id])) &&
    Object.keys(widgets).length === Object.keys(page.widgets ?? {}).length &&
    Object.keys(widgets).every((id) => widgets[id] === page.widgets?.[id]);
  return same ? page : { ...page, widgets, widgetLayout: next };
}

/** The board with its Answers page laid out (see arrangeAnswers). Same board back when nothing changes. */
export function arrangeAnswersIn(s: AgReportState, top?: number, order?: string[]): AgReportState {
  const pages = pagesIn(s) as AnswersPage[];
  let changed = false;
  const next = pages.map((p) => {
    if (p.name !== ANSWERS_PAGE) return p;
    const q = arrangeAnswers(p, top, order);
    if (q !== p) changed = true;
    return q;
  });
  return changed ? ({ ...s, pages: next } as unknown as AgReportState) : s;
}

/** Spotter's own tiles a question can place: complete the moment they're placed, no widget agent needed. */
export const READY_TILES: ReadonlySet<string> = new Set(["fair-price"]);

type AnswerWidget = { type?: string; format?: { title?: { text?: unknown } }; dataMapping?: Record<string, unknown> };

/** A placed answer tile that was never set up (no field mapped). Spotter's ready made tiles never count. */
export function isEmptyAnswer(w: { type?: string; dataMapping?: Record<string, unknown> }): boolean {
  if (READY_TILES.has(w.type ?? "")) return false;
  return !Object.values(w.dataMapping ?? {}).some((v) => Array.isArray(v) && v.length > 0);
}
const sameTitle = (a: unknown, b: string) => typeof a === "string" && a.replace(/\s+/g, " ").trim().toLowerCase() === b;

/**
 * A tile of an allowed type for a typed question (the place_widget tool): newest at the top of the Answers
 * page, full width, older answers pushed down. AG Studio's widget agent then configures it. The same question
 * asked again (same title, or the same ready made tile) gets its old tile back at the top rather than a
 * second one: `reused` when it already shows that chart, or swapped to the new chart type in place. Throws on
 * a type outside the allowed catalogue, so no image or free text tile can be placed this way.
 */
export function placeAnswer(
  s: AgReportState,
  names: Record<string, string>,
  type: string,
  allowed: ReadonlySet<string>,
  title?: string,
  /** Rows for the newest answer and its card (answerRows); the page's current height when left out. */
  top?: number,
): { state: AgReportState; pageId: string; widgetId: string; reused: boolean } {
  if (allowed.size === 0) throw new Error("The widget catalogue isn't available right now, so no tile can be placed. Answer in chat instead.");
  if (!allowed.has(type)) throw new Error(`Spotter can't place a "${String(type).slice(0, 40)}" tile. Pick a chart or table type from the catalogue.`);
  const { state, pageId } = addPage(withNames(s, names), ANSWERS_PAGE);
  type Pg = Page & { widgets?: Record<string, AnswerWidget>; widgetLayout?: Record<string, Box> };
  const pages = pagesIn(state) as Pg[];
  const page = pages.find((p) => p.id === pageId)!;
  const widgets = page.widgets ?? {};
  const name = title?.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, 80) ?? "";
  const key = name.toLowerCase();
  const old = Object.entries(widgets).find(([id, w]) => id.startsWith("answer-") && (READY_TILES.has(type) ? w.type === type : !!key && sameTitle(w.format?.title?.text, key)))?.[0];
  let widgetId = old;
  if (!widgetId) {
    let n = Object.keys(widgets).length + 1;
    while (`answer-${n}` in widgets) n++;
    widgetId = `answer-${n}`;
  }
  // An old tile still empty (its build failed or is still going) is set up again, never passed off as done.
  const reused = !!old && widgets[old]!.type === type && !isEmptyAnswer(widgets[old]!);
  const tile = reused ? widgets[widgetId]! : { type, ...(name ? { format: { title: { enabled: true, text: name } } } : {}) };
  // This answer becomes the newest (large, top left, beside its summary card); the rest keep their order.
  const next = arrangeAnswers({ ...page, widgets: { ...widgets, [widgetId]: tile } } as AnswersPage, top, [widgetId]) as Pg;
  return { state: { ...state, pages: pages.map((p) => (p.id === pageId ? next : p)) } as unknown as AgReportState, pageId, widgetId, reused };
}

/** The newest answer: the answer tile at the top left of the Answers page, for the line above it. */
export function newestAnswer(s: AgReportState): { pageId: string; widgetId: string; title: string; empty: boolean } | null {
  type Pg = Page & { widgets?: Record<string, AnswerWidget>; widgetLayout?: Record<string, Box> };
  const page = (pagesIn(s) as Pg[]).find((p) => p.name === ANSWERS_PAGE);
  if (!page) return null;
  const top = Object.entries(page.widgetLayout ?? {}).find(([id, b]) => id.startsWith("answer-") && b.yTrack === 0 && b.xTrack === 0)?.[0];
  const w = top ? page.widgets?.[top] : undefined;
  if (!top || !w) return null;
  const title = typeof w.format?.title?.text === "string" ? w.format.title.text : "";
  return { pageId: page.id, widgetId: top, title, empty: isEmptyAnswer(w) };
}

export const PHONE_BAR_SPAN = 20;
const PHONE_CARD_SPAN = 30;

/** Phones get one widget per row, full width, in the order you'd read the desktop board. Never saved. */
export function stackForPhone(s: AgReportState): AgReportState {
  const pages = (s.pages as unknown as Array<{ widgets?: Record<string, { type?: string }>; widgetLayout?: Record<string, Box> }>).map((p) => {
    const boxes = Object.entries(p.widgetLayout ?? {}).sort(([, a], [, b]) => a.yTrack - b.yTrack || a.xTrack - b.xTrack);
    let y = 0;
    const widgetLayout: Record<string, Box> = {};
    for (const [id, b] of boxes) {
      // A sideways bar chart needs height on a phone, or it skips every other label.
      // The answer card only needs its text's height on a phone, not the height of the chart beside it.
      const type = p.widgets?.[id]?.type;
      const ySpan = type === SUMMARY_TYPE ? PHONE_CARD_SPAN : type?.startsWith("bar-chart") ? Math.max(b.ySpan, PHONE_BAR_SPAN) : b.ySpan;
      widgetLayout[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan };
      y += ySpan;
    }
    return { ...p, widgetLayout };
  });
  return { ...s, pages } as unknown as AgReportState;
}
