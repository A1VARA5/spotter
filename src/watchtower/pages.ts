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

/** Phones get one widget per row, full width, in the order you'd read the desktop board. Never saved. */
export function stackForPhone(s: AgReportState): AgReportState {
  const pages = (s.pages as unknown as Array<{ widgetLayout?: Record<string, Box> }>).map((p) => {
    const boxes = Object.entries(p.widgetLayout ?? {}).sort(([, a], [, b]) => a.yTrack - b.yTrack || a.xTrack - b.xTrack);
    let y = 0;
    const widgetLayout: Record<string, Box> = {};
    for (const [id, b] of boxes) {
      widgetLayout[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan: b.ySpan };
      y += b.ySpan;
    }
    return { ...p, widgetLayout };
  });
  return { ...s, pages } as unknown as AgReportState;
}
