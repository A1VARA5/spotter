// The board writes itself: when something needs the spotter (money waiting, or a payment stopped or denied
// in the last day), Watchtower opens a page about it before the board loads. Done in code from the rows,
// never by the model, so it's the same every time and costs nothing.
import type { AgReportState } from "ag-studio";
import type { PaymentRow } from "./data";

const DAY = 24 * 3600_000;
const MAX_NEW = 3;

/** The same payment asked again (a scammer retrying, the demo's example and a live run): same person, payee and amount. */
const sameAsk = (r: PaymentRow) => `${r.who}\u0000${r.payee.trim().toLowerCase()}\u0000${r.amount}\u0000${r.currency}`;
/** Of two repeats, the one to show: money still waiting first, then the newest. */
const better = (a: PaymentRow, b: PaymentRow) => Number(b.outcome === "Waiting") - Number(a.outcome === "Waiting") || b.when.getTime() - a.when.getTime() || a.id.localeCompare(b.id);
const worthATab = (r: PaymentRow, now: Date) => r.outcome === "Waiting" || ((r.outcome === "Stopped" || r.outcome === "Denied") && now.getTime() - r.when.getTime() < DAY);

/** New incidents, one per repeated payment, newest first. `repeats` are the other copies, so they count as shown too. */
function pick(rows: PaymentRow[], now: Date, seen: string[]): { picked: PaymentRow[]; repeats: string[] } {
  const skip = new Set(seen);
  const groups = new Map<string, PaymentRow[]>();
  for (const r of rows.filter((r) => !skip.has(r.id) && worthATab(r, now))) groups.set(sameAsk(r), [...(groups.get(sameAsk(r)) ?? []), r]);
  const best = [...groups.values()].map((g) => [...g].sort(better));
  const picked = best
    .map((g) => g[0]!)
    .sort((a, b) => b.when.getTime() - a.when.getTime() || a.id.localeCompare(b.id))
    .slice(0, MAX_NEW);
  const chosen = new Set(picked.map((r) => sameAsk(r)));
  return { picked, repeats: best.filter((g) => chosen.has(sameAsk(g[0]!))).flatMap((g) => g.slice(1).map((r) => r.id)) };
}

export function pickIncidents(rows: PaymentRow[], now: Date, seen: string[]): PaymentRow[] {
  return pick(rows, now, seen).picked;
}

const pounds = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
export const incidentName = (r: PaymentRow) => `Incident: ${r.who} ${pounds(r.amount)}`;
export const incidentPageId = (paymentId: string) => `incident-${paymentId}`;

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const MAX_PAYEE = 16;
/** A payee short enough for a tab: an email's name part, or the first words with an ellipsis. */
export function shortPayee(payee: string): string {
  const flat = payee.replace(/\s+/g, " ").trim();
  const name = /^[^@\s]+@[^@\s]+$/.test(flat) ? flat.split("@")[0]! : flat;
  return name.length <= MAX_PAYEE ? name : `${name.slice(0, MAX_PAYEE - 2).trim()}…`;
}
/** Longer names, used only when a shorter one is already taken: who and how much, then a short payee, then the time. */
const labels = (r: PaymentRow) => [incidentName(r), `${incidentName(r)}, ${shortPayee(r.payee)}`, `${incidentName(r)}, ${shortPayee(r.payee)}, ${clock(r.when)}`];
/** A name an earlier version gave incident tabs ("... to <payee>", maybe with a time), so a board saved then is still ours. */
const oldLabel = (r: PaymentRow, name: string) => name === `${incidentName(r)} to ${r.payee}` || name.startsWith(`${incidentName(r)} to ${r.payee}, `);
const LEVELS = 3;

/**
 * Two tabs called "Incident: Shopping agent £24.99" can't be told apart, so a name that's taken grows by a
 * short payee, then by the time, and if it's still taken gets a number. Only pages still carrying a name
 * this file made (now or in an earlier version) are touched: one the family renamed keeps its name.
 * Returns the same array when nothing changes.
 */
function nameIncidents(pages: Array<{ id?: string; name?: string }>, rows: PaymentRow[]) {
  const byPage = new Map(rows.map((r) => [incidentPageId(r.id), r]));
  const ours = new Map<number, string[]>();
  pages.forEach((p, i) => {
    const r = p.id ? byPage.get(p.id) : undefined;
    if (!r || p.name === undefined) return;
    const options = labels(r);
    if (options.includes(p.name.replace(/ \(\d+\)$/, "")) || oldLabel(r, p.name)) ours.set(i, options);
  });
  if (!ours.size) return pages;
  const level = new Map([...ours.keys()].map((i) => [i, 0]));
  const nameOf = (i: number) => (ours.has(i) ? ours.get(i)![level.get(i)!]! : pages[i]!.name);
  for (let pass = 0; pass < LEVELS; pass++) {
    const count = new Map<string | undefined, number>();
    pages.forEach((_, i) => count.set(nameOf(i), (count.get(nameOf(i)) ?? 0) + 1));
    let bumped = false;
    for (const [i, l] of level) {
      if (l < LEVELS - 1 && count.get(nameOf(i))! > 1) {
        level.set(i, l + 1);
        bumped = true;
      }
    }
    if (!bumped) break;
  }
  // Still the same (same person, amount, short payee and minute): number them in tab order, so every name is unique.
  const final = new Map<number, string>();
  const used = new Set(pages.filter((_, i) => !ours.has(i)).map((p) => p.name));
  for (const i of ours.keys()) {
    let name = nameOf(i)!;
    for (let n = 2; used.has(name); n++) name = `${nameOf(i)} (${n})`;
    used.add(name);
    final.set(i, name);
  }
  const changed = [...final].some(([i, n]) => n !== pages[i]!.name);
  return changed ? pages.map((p, i) => (final.has(i) ? { ...p, name: final.get(i)! } : p)) : pages;
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
const stillOpen = (r: PaymentRow | undefined, now: Date) => Boolean(r) && worthATab(r!, now);

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
  const { picked, repeats } = pick(rows, now, seen);
  const fresh = picked.filter((r) => !existing.has(incidentPageId(r.id)));
  const byPage = new Map(rows.map((r) => [incidentPageId(r.id), r]));
  const ours = (p: { id?: string; name?: string }) => Boolean(p.id?.startsWith("incident-") && p.name?.startsWith("Incident: "));

  const open = (p: { id?: string }) => {
    const r = byPage.get(p.id!);
    return r ? stillOpen(r, now) : !complete;
  };
  let next = [...pages, ...fresh.map(incidentPage)].filter((p) => !ours(p) || open(p));
  // One tab per repeated payment: of two tabs for the same ask, the better one (waiting, else newest) stays.
  const bestOf = new Map<string, PaymentRow>();
  for (const p of next.filter(ours)) {
    const r = byPage.get(p.id!);
    if (!r) continue;
    const had = bestOf.get(sameAsk(r));
    if (!had || better(r, had) < 0) bestOf.set(sameAsk(r), r);
  }
  // The family on a tab that goes as a repeat lands on the tab that stays for it.
  const keptFor = new Map<string, string>();
  next = next.filter((p) => {
    const r = ours(p) ? byPage.get(p.id!) : undefined;
    if (r && bestOf.get(sameAsk(r)) !== r) keptFor.set(p.id!, incidentPageId(bestOf.get(sameAsk(r))!.id));
    return !r || bestOf.get(sameAsk(r)) === r;
  });
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
  const was = (state as { selectedPageId?: string }).selectedPageId;
  const selected = (was && keptFor.get(was)) || was;
  const stillThere = next.some((p) => p.id === selected);
  // Every new one counts as seen, even one capped out, so it never comes back on a later visit.
  const added = [...fresh.map((r) => r.id), ...repeats];
  const changed = added.length > 0 || !stillThere || selected !== was || next.length !== pages.length || next.some((p, i) => p !== pages[i]);
  if (!changed) return { state, added: [], changed: false };
  return { state: { ...state, pages: next, selectedPageId: stillThere ? selected : next[0]?.id } as AgReportState, added, changed };
}
