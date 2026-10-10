// The board writes itself: when something needs the spotter (money waiting, or a payment stopped or denied
// in the last day), Watchtower opens a page about it before the board loads. Done in code from the rows,
// never by the model, so it's the same every time and costs nothing.
import type { AgReportState } from "ag-studio";
import type { PaymentRow } from "./data";

const DAY = 24 * 3600_000;
const MAX_NEW = 3;

export function pickIncidents(rows: PaymentRow[], now: Date, seen: string[]): PaymentRow[] {
  const skip = new Set(seen);
  return rows
    .filter((r) => !skip.has(r.id))
    .filter((r) => r.outcome === "Waiting" || ((r.outcome === "Stopped" || r.outcome === "Denied") && now.getTime() - r.when.getTime() < DAY))
    .sort((a, b) => b.when.getTime() - a.when.getTime() || a.id.localeCompare(b.id))
    .slice(0, MAX_NEW);
}

const pounds = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
export const incidentName = (r: PaymentRow) => `Incident: ${r.who} ${pounds(r.amount)}`;
export const incidentPageId = (paymentId: string) => `incident-${paymentId}`;

const eq = (field: string, value: string) => [{ field: { id: `payments.${field}` }, model: { operator: "equals", value } }];

function incidentPage(r: PaymentRow) {
  return {
    id: incidentPageId(r.id),
    name: incidentName(r),
    widgets: {
      case: { type: "case-file", dataMapping: {} },
      midair: { type: "money-mid-air", dataMapping: {} },
      radar: { type: "scam-radar", dataMapping: {} },
      history: {
        type: "grid",
        dataMapping: { cols: [{ id: "payments.when" }, { id: "payments.payee" }, { id: "payments.amount" }, { id: "payments.outcome" }, { id: "payments.topSign" }] },
        sort: [{ field: { id: "payments.when" }, direction: "desc" }],
        format: { title: { enabled: true, text: `${r.who}'s last payments` } },
      },
    },
    widgetLayout: {
      case: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 18 },
      midair: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 9 },
      radar: { xTrack: 14, yTrack: 9, xSpan: 10, ySpan: 9 },
      history: { xTrack: 0, yTrack: 18, xSpan: 24, ySpan: 14 },
    },
    filter: { widget: { case: eq("id", r.id), midair: eq("id", r.id), radar: eq("payee", r.payee), history: eq("who", r.who) } },
  };
}

/** The board with a page for each new incident, the newest one selected. Pure. */
export function withIncidents(state: AgReportState, rows: PaymentRow[], now: Date, seen: string[]): { state: AgReportState; added: string[] } {
  const pages = (state as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return { state, added: [] };
  const existing = new Set(pages.map((p) => (p as { id?: string }).id));
  const fresh = pickIncidents(rows, now, seen).filter((r) => !existing.has(incidentPageId(r.id)));
  if (!fresh.length) return { state, added: [] };
  return {
    state: { ...state, pages: [...pages, ...fresh.map(incidentPage)], selectedPageId: incidentPageId(fresh[0]!.id) } as AgReportState,
    added: fresh.map((r) => r.id),
  };
}
