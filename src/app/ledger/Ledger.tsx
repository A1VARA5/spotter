"use client";
// The full ledger: every payment Spotter has seen, with its evidence, market price and PayPal ids.
// Built on AG Grid Community (MIT), themed with Spotter's tokens.
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { money, STATE_LABEL, timeAgo, trackState, type TrackState } from "@/ui/format";
import type { Payment } from "@/core/lifecycle";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  fontSize: 15,
  headerFontSize: 14,
  headerFontWeight: 600,
  backgroundColor: "#ffffff",
  foregroundColor: "#17212b",
  headerBackgroundColor: "#f3f5f2",
  headerTextColor: "#4a5866",
  borderColor: "#d5dbd6",
  rowBorder: { color: "#e3e7e3" },
  accentColor: "#2c55c9",
  rowHoverColor: "rgb(242 183 5 / 0.10)",
  selectedRowBackgroundColor: "rgb(242 183 5 / 0.18)",
  borderRadius: 12,
  wrapperBorderRadius: 18,
  spacing: 7,
  rowVerticalPaddingScale: 1.3,
});

type Row = {
  id: string;
  when: string;
  who: string;
  payee: string;
  item: string;
  amount: number;
  currency: string;
  state: TrackState;
  why: string;
  market: string;
  paypal: string;
};

function toRow(p: Payment, names: Record<string, string>): Row {
  const s = trackState(p.status);
  const m = p.market;
  return {
    id: p.id,
    when: p.created_at,
    who: names[p.spender_id] ?? "Someone",
    payee: p.request.payee.name,
    item: p.request.item ?? p.request.category,
    amount: Number(p.amount),
    currency: p.currency,
    state: s,
    why: s === "failed" ? (p.error ?? "") : (p.decision?.reasons[0] ?? "Within the rules."),
    market: m?.cheapest && m.median ? `${money(m.cheapest.price, p.currency)} at ${m.cheapest.domain}` : "",
    paypal: p.paypal_capture_id ?? p.paypal_authorization_id ?? "",
  };
}

const FILTERS: Array<{ label: string; states: TrackState[] | null }> = [
  { label: "Everything", states: null },
  { label: "Waiting for you", states: ["held"] },
  { label: "Stopped", states: ["blocked", "protected", "failed"] },
  { label: "Paid", states: ["paid"] },
];

function StateCell({ value }: ICellRendererParams<Row, TrackState>) {
  if (!value) return null;
  return (
    <span className="feed-state" data-state={value}>
      {STATE_LABEL[value]}
    </span>
  );
}

export function Ledger({ payments, names }: { payments: Payment[]; names: Record<string, string> }) {
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => payments.map((p) => toRow(p, names)), [payments, names]);
  const shown = useMemo(() => {
    const states = FILTERS[filter]!.states;
    return states ? rows.filter((r) => states.includes(r.state)) : rows;
  }, [rows, filter]);

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "when", headerName: "When", width: 108, valueFormatter: (p) => timeAgo(p.value), sort: "desc" },
      { field: "who", headerName: "Who", width: 150 },
      {
        field: "payee",
        headerName: "Paid to",
        flex: 1,
        minWidth: 150,
        tooltipValueGetter: (p) => (p.data?.item ? `${p.value}, for ${p.data.item}` : p.value),
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 104,
        type: "rightAligned",
        valueFormatter: (p) => money(p.value, p.data!.currency),
        cellClass: "num ledger-amount",
      },
      { field: "state", headerName: "Outcome", width: 168, cellRenderer: StateCell },
      { field: "why", headerName: "Why", flex: 2, minWidth: 220, wrapText: true, autoHeight: true, cellClass: "ledger-why" },
      { field: "market", headerName: "Real shops (Channel3)", width: 176, tooltipField: "market" },
      { field: "paypal", headerName: "PayPal id", width: 150, cellClass: "ledger-id", tooltipField: "paypal" },
    ],
    [],
  );

  return (
    <section className="ledger" aria-label="All payments">
      <div className="ledger-bar">
        <div className="stage-tabs" role="group" aria-label="Show">
          {FILTERS.map((f, i) => (
            <button key={f.label} className="stage-tab" aria-pressed={i === filter} onClick={() => setFilter(i)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="ledger-search">
          Search payments
        </label>
        <input
          id="ledger-search"
          className="ledger-search"
          type="search"
          placeholder="Search payee, item or reason"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="ledger-grid">
        <AgGridReact<Row>
          theme={theme}
          rowData={shown}
          columnDefs={columns}
          quickFilterText={search}
          getRowId={(p) => p.data.id}
          domLayout="autoHeight"
          pagination
          paginationPageSize={20}
          paginationPageSizeSelector={[20, 50, 100]}
          overlayNoRowsTemplate="<span>No payments here yet. Run a scenario from Try it.</span>"
        />
      </div>
    </section>
  );
}
