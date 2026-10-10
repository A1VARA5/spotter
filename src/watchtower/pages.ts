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
