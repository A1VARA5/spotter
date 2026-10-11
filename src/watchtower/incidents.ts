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

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
/** Longer names, used only when a shorter one is already taken: who and how much, then the payee, then the time. */
const labels = (r: PaymentRow) => [incidentName(r), `${incidentName(r)} to ${r.payee}`, `${incidentName(r)} to ${r.payee}, ${clock(r.when)}`];

/**
 * Two tabs called "Incident: Shopping agent £24.99" can't be told apart, so a name that's taken grows by
 * the payee, then by the time. Only pages still carrying a name this file made are touched: one the family
 * renamed keeps its name. Returns the same array when nothing changes.
 */
function nameIncidents(pages: Array<{ id?: string; name?: string }>, rows: PaymentRow[]) {
  const byPage = new Map(rows.map((r) => [incidentPageId(r.id), r]));
  const ours = new Map<number, string[]>();
  pages.forEach((p, i) => {
    const r = p.id ? byPage.get(p.id) : undefined;
    const options = r ? labels(r) : null;
    if (options && p.name !== undefined && options.includes(p.name)) ours.set(i, options);
  });
  if (!ours.size) return pages;
  const level = new Map([...ours.keys()].map((i) => [i, 0]));
  const nameOf = (i: number) => (ours.has(i) ? ours.get(i)![level.get(i)!]! : pages[i]!.name);
  for (let pass = 0; pass < 3; pass++) {
    const count = new Map<string | undefined, number>();
    pages.forEach((_, i) => count.set(nameOf(i), (count.get(nameOf(i)) ?? 0) + 1));
    let bumped = false;
    for (const [i, l] of level) {
      if (l < 2 && count.get(nameOf(i))! > 1) {
        level.set(i, l + 1);
        bumped = true;
      }
    }
    if (!bumped) break;
  }
  const changed = [...ours.keys()].some((i) => nameOf(i) !== pages[i]!.name);
  return changed ? pages.map((p, i) => (ours.has(i) ? { ...p, name: nameOf(i) } : p)) : pages;
}

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
      case: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 21 },
      midair: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 10 },
      radar: { xTrack: 14, yTrack: 10, xSpan: 10, ySpan: 11 },
      history: { xTrack: 0, yTrack: 21, xSpan: 24, ySpan: 12 },
    },
    filter: { widget: { case: eq("id", r.id), midair: eq("id", r.id), radar: eq("payee", r.payee), history: eq("who", r.who) } },
  };
}

/** Incident tabs open at once. Older ones close, so the tab strip never piles up. */
const MAX_OPEN = 3;

/** Still worth a tab: money waiting, or stopped or denied in the last day. */
const stillOpen = (r: PaymentRow | undefined, now: Date) =>
  Boolean(r) && (r!.outcome === "Waiting" || ((r!.outcome === "Stopped" || r!.outcome === "Denied") && now.getTime() - r!.when.getTime() < DAY));

/**
 * The board with a page for each new incident. Pure. The family stays on the page they were on (This month on a
 * fresh board), at most three incident tabs stay open (the newest), and a tab whose payment is over (paid,
 * cleared by Start fresh, stopped more than a day ago) closes. A tab the family renamed is theirs and stays.
 * changed says whether the board needs saving.
 */
export function withIncidents(
  state: AgReportState,
  rows: PaymentRow[],
  now: Date,
  seen: string[],
  /** False when rows were capped: then a missing row isn't proof the payment is gone, so its tab stays. */
  complete = true,
): { state: AgReportState; added: string[]; changed: boolean } {
  const pages = (state as { pages?: unknown }).pages as Array<{ id?: string; name?: string }> | undefined;
  if (!Array.isArray(pages)) return { state, added: [], changed: false };
  const existing = new Set(pages.map((p) => p.id));
  const fresh = pickIncidents(rows, now, seen).filter((r) => !existing.has(incidentPageId(r.id)));
  const byPage = new Map(rows.map((r) => [incidentPageId(r.id), r]));
  const ours = (p: { id?: string; name?: string }) => Boolean(p.id?.startsWith("incident-") && p.name?.startsWith("Incident: "));

  const open = (p: { id?: string }) => {
    const r = byPage.get(p.id!);
    return r ? stillOpen(r, now) : !complete;
  };
  let next = [...pages, ...fresh.map(incidentPage)].filter((p) => !ours(p) || open(p));
  const when = (p: { id?: string }) => byPage.get(p.id!)?.when.getTime() ?? 0;
  const keep = new Set(
    next
      .filter(ours)
      .sort((a, b) => when(b) - when(a) || a.id!.localeCompare(b.id!))
      .slice(0, MAX_OPEN)
      .map((p) => p.id),
  );
  next = nameIncidents(
    next.filter((p) => !ours(p) || keep.has(p.id)),
    rows,
  );
  const selected = (state as { selectedPageId?: string }).selectedPageId;
  const stillThere = next.some((p) => p.id === selected);
  // Every new one counts as seen, even one capped out, so it never comes back on a later visit.
  const added = fresh.map((r) => r.id);
  const changed = added.length > 0 || !stillThere || next.length !== pages.length || next.some((p, i) => p !== pages[i]);
  if (!changed) return { state, added: [], changed: false };
  return { state: { ...state, pages: next, selectedPageId: stillThere ? selected : next[0]?.id } as AgReportState, added, changed };
}
