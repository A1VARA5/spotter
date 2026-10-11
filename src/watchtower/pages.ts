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
 * Measured on the demo board at 1920 and 2560 so the fullest tile still fits.
 */
export const wideFactor = (width: number, rows = 28) => (width >= 2300 ? (rows >= 25 ? 0.66 : 0.8) : width >= 1800 ? (rows >= 25 ? 0.8 : 0.9) : 1);

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
/** Rows an answer tile gets: room for a chart with its labels. */
export const ANSWER_SPAN = 14;

/**
 * An empty tile of an allowed type for a typed question (the place_widget tool): newest at the top of the
 * Answers page, full width, older answers pushed down. AG Studio's widget agent then configures it. Throws on
 * a type outside the allowed catalogue, so no image or free text tile can be placed this way.
 */
export function placeAnswer(s: AgReportState, names: Record<string, string>, type: string, allowed: ReadonlySet<string>): { state: AgReportState; pageId: string; widgetId: string } {
  if (!allowed.has(type)) throw new Error(`Spotter can't place a "${String(type).slice(0, 40)}" tile. Pick a chart or table type from the catalogue.`);
  const { state, pageId } = addPage(withNames(s, names), ANSWERS_PAGE);
  type Pg = Page & { widgets?: Record<string, unknown>; widgetLayout?: Record<string, Box> };
  const pages = pagesIn(state) as Pg[];
  const page = pages.find((p) => p.id === pageId)!;
  const widgets = page.widgets ?? {};
  let n = Object.keys(widgets).length + 1;
  while (`answer-${n}` in widgets) n++;
  const widgetId = `answer-${n}`;
  const moved = Object.fromEntries(Object.entries(page.widgetLayout ?? {}).map(([id, b]) => [id, { ...b, yTrack: b.yTrack + ANSWER_SPAN }]));
  const next: Pg = { ...page, widgets: { ...widgets, [widgetId]: { type } }, widgetLayout: { [widgetId]: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: ANSWER_SPAN }, ...moved } };
  return { state: { ...state, pages: pages.map((p) => (p.id === pageId ? next : p)) } as unknown as AgReportState, pageId, widgetId };
}

export const PHONE_BAR_SPAN = 20;

/** Phones get one widget per row, full width, in the order you'd read the desktop board. Never saved. */
export function stackForPhone(s: AgReportState): AgReportState {
  const pages = (s.pages as unknown as Array<{ widgets?: Record<string, { type?: string }>; widgetLayout?: Record<string, Box> }>).map((p) => {
    const boxes = Object.entries(p.widgetLayout ?? {}).sort(([, a], [, b]) => a.yTrack - b.yTrack || a.xTrack - b.xTrack);
    let y = 0;
    const widgetLayout: Record<string, Box> = {};
    for (const [id, b] of boxes) {
      // A sideways bar chart needs height on a phone, or it skips every other label.
      const ySpan = p.widgets?.[id]?.type?.startsWith("bar-chart") ? Math.max(b.ySpan, PHONE_BAR_SPAN) : b.ySpan;
      widgetLayout[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan };
      y += ySpan;
    }
    return { ...p, widgetLayout };
  });
  return { ...s, pages } as unknown as AgReportState;
}
