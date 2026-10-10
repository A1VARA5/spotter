// The board every family starts with (and gets back from "Reset board"). Plain data, so the server page
// can add incident pages to it before Studio loads.
import type { AgReportState } from "ag-studio";

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
        alerts: { xTrack: 0, yTrack: 11, xSpan: 9, ySpan: 14 },
        midair: { xTrack: 9, yTrack: 11, xSpan: 15, ySpan: 14 },
        replay: { xTrack: 0, yTrack: 25, xSpan: 24, ySpan: 14 },
        outcomes: { xTrack: 0, yTrack: 39, xSpan: 8, ySpan: 13 },
        signs: { xTrack: 8, yTrack: 39, xSpan: 8, ySpan: 13 },
        radar: { xTrack: 16, yTrack: 39, xSpan: 8, ySpan: 13 },
        people: { xTrack: 0, yTrack: 52, xSpan: 13, ySpan: 13 },
        categories: { xTrack: 13, yTrack: 52, xSpan: 11, ySpan: 13 },
        ledger: { xTrack: 0, yTrack: 65, xSpan: 24, ySpan: 16 },
      },
    },
  ],
  selectedPageId: "month",
  panels: { filters: { collapsed: true }, ai: { collapsed: false }, data: { collapsed: true }, edit: { collapsed: true } },
} as never;
