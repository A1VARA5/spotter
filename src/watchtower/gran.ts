// The simple view of Watchtower: the same family data, written for the person Spotter looks out for
// (Gran, a kid) rather than the spotter. Plain sums and words here, kept out of React so they can be
// tested; the widgets in src/app/watchtower/GranWidgets.tsx only draw them.
// Payee names and reasons can carry a scammer's words: they are only ever shown as plain text.
import type { AgReportState, AgStudioThemeParams } from "ag-studio";
import type { HouseholdKind } from "@/core/households";
import type { CaseNote, PaymentRow, PersonRow } from "./data";

export type GranLabels = { who: string | null; viewLabel: string; waitingTitle: string; spotter: string };

const MAX_NAME = 24;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Who the simple view is for: the first older relative, else the first kid. A business, or a family of
 * only agents, gets "Simple view". The label uses the first name so it stays short on a phone.
 */
export function granLabels(people: PersonRow[], kind: HouseholdKind, spotterName: string): GranLabels {
  const spotter = clean(spotterName).slice(0, MAX_NAME) || "your spotter";
  const pick = kind === "business" ? undefined : (people.find((p) => p.kind === "Person") ?? people.find((p) => p.kind === "Kid"));
  const who = pick ? clean(pick.name) || null : null;
  const first = who?.split(" ")[0]?.slice(0, MAX_NAME);
  return { who, viewLabel: first ? `${first}'s view` : "Simple view", waitingTitle: `Waiting for ${spotter}`, spotter };
}

// Payment ids, household ids and long PayPal style ids mean nothing to Gran.
const IDS = /\b(?:pay|hh|sp|spn|pay_sample)_[A-Za-z0-9_-]+|\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{12,}\b/g;
const MAX_SENTENCE = 140;

/** The first sentence of Spotter's own words, with ids taken out and a sensible length. */
export function plainSentence(text: string): string {
  const flat = clean(text.replace(IDS, " ")).replace(/\s+([.,!?])/g, "$1");
  if (!flat) return "";
  const first = flat.split(/(?<=[.!?])\s+/)[0] ?? flat;
  if (first.length <= MAX_SENTENCE) return first;
  const cut = first.slice(0, MAX_SENTENCE);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : MAX_SENTENCE).trim()}…`;
}

/** The advice the rest of Spotter gives (decide.ts, alerts): don't pay, ring a number you trust. */
export const ADVICE = "Don't pay. Ring them on a number you already have, not one from the message.";

// Spotter's sign labels (data.ts SIGN_LABEL) as the trick a scammer tried, in plain words.
const TRICK: Record<string, string> = {
  "Pressure to hurry": "They tried to rush you.",
  "Pretending to be someone": "They pretended to be someone you trust.",
  "Asks for Friends and Family": "They asked for Friends and Family, which can't be undone.",
  "Gift cards or crypto": "They asked for gift cards or crypto.",
  "Hidden instructions for AI": "The shop hid orders for a computer in its page.",
  "Price looks wrong": "The price was too good to be true.",
  "Brand new shop": "The shop was brand new.",
  "Bank details changed": "They said their bank details had changed.",
  "Something else odd": "Something about it didn't add up.",
};

/** currency is missing on rows that came through the board's data (pounds there for now). */
export type GranRow = Pick<PaymentRow, "id" | "when" | "who" | "payee" | "amount" | "outcome" | "topSign" | "sample"> & { currency?: string };
export type GranStop = { id: string; when: Date; payee: string; amount: number; currency: string; by: string; sentence: string; sample: boolean };
/** ends: when PayPal lets the hold go on its own; asleep: someone chose "ask again tomorrow". */
export type GranWait = { id: string; when: Date; payee: string; amount: number; currency: string; status: string; ends?: string; asleep: boolean; sample: boolean };
export type GranTrick = { sign: string; plain: string; count: number };
export type GranMonth = { kept: number; stopped: GranStop[]; waiting: GranWait[]; tricks: GranTrick[] };

const MONTH = 30 * 24 * 3600_000;
const round = (n: number) => Math.round(n * 100) / 100;

/** This month for one person (or everyone when `who` is null): what was stopped, what waits, which tricks. */
export function granMonth(rows: GranRow[], notes: Map<string, CaseNote>, o: { who: string | null; spotter: string; now: Date }): GranMonth {
  const mine = rows.filter((r) => (o.who === null || r.who === o.who) && o.now.getTime() - r.when.getTime() < MONTH);
  const stopped = mine
    .filter((r) => r.outcome === "Stopped" || r.outcome === "Denied")
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .map((r): GranStop => {
      const denied = r.outcome === "Denied";
      const said = plainSentence(notes.get(r.id)?.reasons[0] ?? "");
      return {
        id: r.id,
        when: r.when,
        payee: r.payee,
        amount: r.amount,
        currency: r.currency ?? "GBP",
        by: denied ? `${o.spotter} said no` : "Spotter stopped it",
        sentence: said || (denied ? `${o.spotter} said no, so nothing was paid.` : "Spotter stopped it before any money left."),
        sample: r.sample === "Yes",
      };
    });
  const waiting = mine
    .filter((r) => r.outcome === "Waiting")
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .map((r): GranWait => {
      const wait = notes.get(r.id)?.wait;
      return {
        id: r.id,
        when: r.when,
        payee: r.payee,
        amount: r.amount,
        currency: r.currency ?? "GBP",
        status: wait?.askAgain
          ? `Sleeping on it. Spotter asks ${o.spotter} again ${wait.askAgain}. The money stays put until then.`
          : `${o.spotter} has been asked. PayPal keeps the money safe until they decide.`,
        ...(wait?.holdEnds ? { ends: `If nobody says yes by ${wait.holdEnds}, the money comes back to you.` } : {}),
        asleep: Boolean(wait?.askAgain),
        sample: r.sample === "Yes",
      };
    });
  const counts = new Map<string, number>();
  for (const r of mine) {
    if (r.outcome === "Paid") continue;
    const signs = notes.get(r.id)?.signs.map((s) => s.sign) ?? (r.topSign !== "None" ? [r.topSign] : []);
    for (const sign of new Set(signs)) if (TRICK[sign]) counts.set(sign, (counts.get(sign) ?? 0) + 1);
  }
  const tricks = [...counts].map(([sign, count]) => ({ sign, plain: TRICK[sign]!, count })).sort((a, b) => b.count - a.count || a.sign.localeCompare(b.sign));
  return { kept: round(stopped.reduce((t, s) => t + s.amount, 0)), stopped, waiting, tricks };
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const daysAgo = (when: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - when.getTime()) / (24 * 3600_000)));

const cash = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return gbp.format(amount); // an unknown code: Spotter only takes GBP and USD
  }
};

/** Money kept per currency ("£25.00 and $119.00"): pounds and dollars are never added together. */
function keptByCurrency(stopped: GranStop[]): string {
  const totals = new Map<string, number>();
  for (const s of stopped) totals.set(s.currency, round((totals.get(s.currency) ?? 0) + s.amount));
  return totals.size ? [...totals].map(([c, n]) => cash(n, c)).join(" and ") : gbp.format(0);
}

/** What the simple view's agent reads (the my_month tool): the month in words and each payment's own money, no ids at all. */
export function granForAgent(m: GranMonth, now: Date) {
  return {
    keptThisMonth: keptByCurrency(m.stopped),
    stopped: m.stopped.map((s) => ({ payee: s.payee, amount: cash(s.amount, s.currency), daysAgo: daysAgo(s.when, now), what: s.by, why: s.sentence, sample: s.sample })),
    waiting: m.waiting.map((w) => ({ payee: w.payee, amount: cash(w.amount, w.currency), daysAgo: daysAgo(w.when, now), status: w.status, ...(w.ends ? { ends: w.ends } : {}), sample: w.sample })),
    tricks: m.tricks.map((t) => ({ trick: t.plain, times: t.count })),
    advice: ADVICE,
  };
}

// ---------- theme ----------

/**
 * The simple view's colours. Spotter's own palette (DESIGN.md), darkened where text sits on it so every
 * pair clears WCAG AA with room to spare, on a white page like GOV.UK and NHS pages.
 */
export const GRAN_TOKENS = {
  canvas: "#EEF1ED",
  paper: "#FFFFFF",
  ink: "#17212B",
  ink2: "#384552",
  line: "#B9C2BC",
  stop: "#A3261D",
  stopSoft: "#FBEDEB",
  go: "#17694A",
  goSoft: "#E8F3EE",
  hold: "#F2B705",
  holdSoft: "#FDF4D6",
  protect: "#2448AE",
} as const;
export type GranToken = keyof typeof GRAN_TOKENS;

/** Every text colour and the surfaces it is drawn on. Tested to 4.5:1. */
export const GRAN_PAIRS: Array<[GranToken, GranToken]> = [
  ["ink", "paper"],
  ["ink", "canvas"],
  ["ink2", "paper"],
  ["ink2", "canvas"],
  ["stop", "paper"],
  ["stop", "stopSoft"],
  ["go", "paper"],
  ["go", "goSoft"],
  ["ink", "hold"],
  ["ink", "holdSoft"],
  ["protect", "paper"],
  ["paper", "ink"],
];

const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2 contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const FONT = "var(--font-sans), system-ui, sans-serif";

/** AG Studio theme params for the simple view: big type, roomy rows, quiet chrome. */
export function granThemeParams(): Partial<AgStudioThemeParams> {
  const t = GRAN_TOKENS;
  return {
    fontFamily: FONT,
    chartFontFamily: FONT,
    gridFontFamily: FONT,
    studioWidgetTitleFontFamily: FONT,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: 400,
    browserColorScheme: "light",
    backgroundColor: t.canvas,
    foregroundColor: t.ink,
    textColor: t.ink,
    subtleTextColor: t.ink2,
    borderColor: t.line,
    accentColor: t.protect,
    invalidColor: t.stop,
    borderRadius: 12,
    focusShadow: { spread: 4, color: t.hold },
    tooltipBackgroundColor: t.ink,
    tooltipTextColor: t.paper,
    studioCanvasBackgroundColor: t.canvas,
    studioCanvasPadding: 6,
    studioWidgetBackgroundColor: t.paper,
    studioWidgetBorder: { style: "solid", width: 1, color: t.line },
    studioWidgetBorderRadius: 16,
    studioWidgetPadding: 14,
    studioWidgetTitleFontSize: 26,
    studioWidgetTitleFontWeight: 650,
    studioWidgetTitleTextColor: t.ink,
    studioValueWidgetFontSize: 40,
    gridFontSize: 20,
    gridDataFontSize: 20,
    gridCellFontSize: 20,
    gridCellTextColor: t.ink,
    gridHeaderFontSize: 18,
    gridHeaderFontWeight: 650,
    gridHeaderTextColor: t.ink,
    gridHeaderBackgroundColor: t.paper,
    gridHeaderHeight: 56,
    gridRowHeight: 64,
    gridRowBorder: { style: "solid", width: 1, color: t.line },
    gridOddRowBackgroundColor: t.paper,
    gridRowHoverColor: t.canvas,
    chartFontSize: 18,
    chartTextColor: t.ink,
    chartSubtleTextColor: t.ink2,
  };
}

// ---------- board ----------

const title = (text: string) => ({ title: { enabled: true, text } });

// Track heights, one widget per row. Phones wrap the big type onto more lines, so their tiles are taller.
const SPANS = { wide: { safe: 38, waiting: 22, scams: 25, payments: 36 }, phone: { safe: 62, waiting: 46, scams: 56, payments: 40 } };

/** One page, read from top to bottom: safe, waiting, scams, then every payment. No charts. */
export function granBoard(who: string | null, phone = false): AgReportState {
  const h = SPANS[phone ? "phone" : "wide"];
  const order = ["safe", "waiting", "scams", "payments"] as const;
  let y = 0;
  const widgetLayout: Record<string, unknown> = {};
  for (const id of order) {
    widgetLayout[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan: h[id] };
    y += h[id];
  }
  const page: Record<string, unknown> = {
    id: "gran",
    name: "This month",
    widgets: {
      safe: { type: "gran-safe", dataMapping: {} },
      waiting: { type: "gran-waiting", dataMapping: {} },
      scams: { type: "gran-scams", dataMapping: {} },
      payments: {
        type: "grid",
        // Three columns that fit at Gran's type size: who, how much, what happened. Newest first.
        dataMapping: { cols: [{ id: "payments.payee" }, { id: "payments.amount" }, { id: "payments.outcome" }] },
        sort: [{ field: { id: "payments.when" }, direction: "desc" }],
        format: title(who ? `${who.split(" ")[0]}'s payments` : "Every payment"),
      },
    },
    // One column, read top to bottom like a GOV.UK page; tall enough that most months need no scrolling inside.
    widgetLayout,
  };
  if (who) page.filter = { page: [{ field: { id: "payments.who" }, model: { operator: "equals", value: who } }] };
  return { pages: [page], selectedPageId: "gran", panels: { filters: { collapsed: true } } } as unknown as AgReportState;
}
