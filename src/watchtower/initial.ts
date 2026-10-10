// The board every family starts with (and gets back from "Reset board"). Plain data, so the server page
// can add incident pages to it before Studio loads.
import type { AgReportState } from "ag-studio";
import type { HouseholdKind } from "@/core/households";
import type { PersonRow } from "./data";

const title = (text: string) => ({ title: { enabled: true, text } });

export const INITIAL: AgReportState = {
  pages: [
    {
      id: "month",
      name: "This month",
      widgets: {
        kept: { type: "money-kept", dataMapping: { value: [{ id: "payments.moneyKept", aggregation: "sum" }] } },
        track: { type: "hold-track", dataMapping: { category: [{ id: "payments.outcome" }], value: [{ id: "payments.id", aggregation: "count" }] } },
        alerts: { type: "watch-alerts", dataMapping: {} },
        fair: { type: "fair-price", dataMapping: {} },
        midair: { type: "money-mid-air", dataMapping: {} },
        replay: { type: "replay", dataMapping: {} },
        outcomes: { type: "donut-chart", dataMapping: { categoryKey: [{ id: "payments.outcome" }], valueKey: [{ id: "payments.id", aggregation: "count" }] }, format: title("What happened to each payment") },
        signs: { type: "bar-chart-grouped", dataMapping: { categoryKey: [{ id: "signs.sign" }], valueKey: [{ id: "signs.paymentId", aggregation: "count" }] }, format: title("Scam signs Spotter caught") },
        radar: { type: "scam-radar", dataMapping: {} },
        people: { type: "column-chart-stacked", dataMapping: { categoryKey: [{ id: "payments.who" }], valueKey: [{ id: "payments.amount", aggregation: "sum" }], legendKey: [{ id: "payments.outcome" }] }, format: title("Who asked to pay, and what happened") },
        categories: {
          type: "grid",
          dataMapping: { cols: [{ id: "payments.category" }, { id: "payments.amount", aggregation: "sum" }, { id: "payments.id", aggregation: "count" }] },
          sort: [{ field: { id: "payments.amount", aggregation: "sum" }, direction: "desc" }],
          format: title("What the money was for"),
        },
        ledger: {
          type: "grid",
          dataMapping: { cols: [{ id: "payments.when" }, { id: "payments.who" }, { id: "payments.payee" }, { id: "payments.amount" }, { id: "payments.outcome" }, { id: "payments.topSign" }, { id: "payments.sample" }] },
          sort: [{ field: { id: "payments.when" }, direction: "desc" }],
          format: title("Every payment"),
        },
      },
      widgetLayout: {
        kept: { xTrack: 0, yTrack: 0, xSpan: 7, ySpan: 11 },
        track: { xTrack: 7, yTrack: 0, xSpan: 17, ySpan: 11 },
        alerts: { xTrack: 0, yTrack: 11, xSpan: 8, ySpan: 14 },
        fair: { xTrack: 8, yTrack: 11, xSpan: 8, ySpan: 14 },
        midair: { xTrack: 16, yTrack: 11, xSpan: 8, ySpan: 14 },
        replay: { xTrack: 0, yTrack: 25, xSpan: 24, ySpan: 16 },
        outcomes: { xTrack: 0, yTrack: 41, xSpan: 8, ySpan: 13 },
        signs: { xTrack: 8, yTrack: 41, xSpan: 8, ySpan: 13 },
        radar: { xTrack: 16, yTrack: 41, xSpan: 8, ySpan: 13 },
        people: { xTrack: 0, yTrack: 54, xSpan: 13, ySpan: 13 },
        categories: { xTrack: 13, yTrack: 54, xSpan: 11, ySpan: 13 },
        ledger: { xTrack: 0, yTrack: 67, xSpan: 24, ySpan: 16 },
      },
    },
  ],
  selectedPageId: "month",
  panels: { filters: { collapsed: true }, ai: { collapsed: false }, data: { collapsed: true }, edit: { collapsed: true } },
} as never;

// A small business gets the same widgets, titled in its own words, and suppliers (payees) in place of categories.
const BUSINESS: AgReportState = (() => {
  const b = structuredClone(INITIAL) as unknown as { pages: Array<{ widgets: Record<string, Record<string, unknown>> }> };
  const w = b.pages[0]!.widgets;
  w.people = { ...w.people, format: title("Spend by person") };
  w.signs = { ...w.signs, format: title("Invoices caught") };
  w.categories = {
    ...w.categories,
    dataMapping: { cols: [{ id: "payments.payee" }, { id: "payments.amount", aggregation: "sum" }, { id: "payments.id", aggregation: "count" }] },
    format: title("Suppliers"),
  };
  return b as never;
})();

/** The board a household starts with (and gets back from "Reset board"). Families keep the original. */
export const startingBoard = (kind: HouseholdKind): AgReportState => (kind === "business" ? BUSINESS : INITIAL);

/** The assistant's suggested questions, built from the household's own people. */
export function promptStarters(people: PersonRow[], kind: HouseholdKind): Array<{ label: string; prompt: string }> {
  const kid = people.find((p) => p.kind === "Kid")?.name;
  const relative = people.find((p) => p.kind === "Person")?.name;
  // The first two go to Spotter's own agent: a live Channel3 price check, and the weekly brief it hands
  // to the brief agent, which hands the building to Studio's page and widget agents.
  const fair = { label: "Did we pay fair prices this month?", prompt: "Did we pay fair prices this month? Compare what we paid with what real shops charge today, and show it on the board." };
  const brief = { label: "Write this week's brief", prompt: "Write our weekly brief for this week." };
  if (kind === "business")
    return [
      fair,
      brief,
      { label: "Which invoices were caught?", prompt: "Which supplier payments were held or stopped this month? Open the case files and explain in a few sentences." },
      { label: "Who spent the most?", prompt: "Show spend by person this month and tell me anything odd." },
      { label: "Build a supplier report", prompt: "Add a new page called Supplier report: spend by supplier, scam signs by kind, the scam radar, and a table of every stopped or denied payment." },
    ];
  return [
    fair,
    brief,
    ...(relative ? [{ label: `Why was ${relative} stopped?`, prompt: `Why were ${relative}'s payments held or stopped this month? Open the case files and explain in a few sentences.` }] : []),
    ...(kid ? [{ label: `What did ${kid} spend on games?`, prompt: `What did ${kid} spend on games this month? Add a widget that shows it.` }] : []),
    { label: "Build a scam report", prompt: "Add a new page called Scam report: scam signs by person and by kind, the scam radar, and a table of every stopped or denied payment." },
  ];
}
