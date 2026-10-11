"use client";
// The full ledger: every payment Spotter has seen, with its evidence, market price and PayPal ids.
// Built on AG Grid Community (MIT), themed with Spotter's tokens. A row opens that payment's case file in a drawer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellKeyDownEvent,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { FileText, X } from "lucide-react";
import { money, STATE_LABEL, timeAgo, trackState, type TrackState } from "@/ui/format";
import { marketCell } from "@/core/market";
import type { Payment } from "@/core/lifecycle";
import { CaseFile } from "@/ui/CaseFile";
import { kernelLead, realOne, unsaidReasons } from "@/ui/caseFold";
import { MarketNote } from "@/ui/components";
import "./ledger.css";

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
    // The same going rate as the card's price note and the reasons line (src/core/market.ts marketSummary).
    market: marketCell(p.market, p.currency),
    paypal: p.paypal_capture_id ?? p.paypal_authorization_id ?? "",
  };
}

const FILTERS: Array<{ label: string; states: TrackState[] | null }> = [
  { label: "Everything", states: null },
  { label: "Waiting for you", states: ["held"] },
  { label: "Stopped", states: ["blocked", "failed"] },
  { label: "Not sent", states: ["protected"] },
  { label: "Denied", states: ["returned"] },
  { label: "Paid", states: ["paid"] },
];

/** Columns a phone has no room for: the drawer shows all of them for the row that's opened. */
const WIDE_ONLY = ["when", "why", "market", "paypal"];
const PHONE = 760;
const EVIDENCE_FOR = new Set(["needs_approval", "voiding", "voided", "blocked", "protected"]);

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
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => payments.map((p) => toRow(p, names)), [payments, names]);
  const shown = useMemo(() => {
    const states = FILTERS[filter]!.states;
    return states ? rows.filter((r) => states.includes(r.state)) : rows;
  }, [rows, filter]);
  const open = openId ? (payments.find((p) => p.id === openId) ?? null) : null;

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "when", headerName: "When", width: 108, valueFormatter: (p) => timeAgo(p.value), sort: "desc" },
      { field: "who", headerName: "Who", width: 140 },
      {
        field: "payee",
        headerName: "Paid to",
        flex: 1,
        minWidth: 140,
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
      { field: "state", headerName: "Outcome", width: 168, cellRenderer: StateCell, wrapText: true, autoHeight: true },
      { field: "why", headerName: "Why", flex: 2, minWidth: 220, wrapText: true, autoHeight: true, cellClass: "ledger-why" },
      {
        field: "market",
        headerName: "Real shop prices (Channel3)",
        width: 200,
        wrapText: true,
        autoHeight: true,
        wrapHeaderText: true,
        autoHeaderHeight: true,
        cellClass: "ledger-market",
        tooltipField: "market",
      },
      { field: "paypal", headerName: "PayPal id", width: 150, cellClass: "ledger-id", tooltipField: "paypal" },
    ],
    [],
  );

  // Phones keep who, paid to, amount and outcome; the rest is one tap away in the drawer.
  const gridBox = useRef<HTMLDivElement>(null);
  const fit = useCallback((api: GridApi<Row>) => {
    const wide = (gridBox.current?.clientWidth ?? window.innerWidth) >= PHONE;
    api.setColumnsVisible(WIDE_ONLY, wide);
    // On a phone who, amount and outcome share the width (paid to is in the drawer); on wider screens the set widths.
    api.setColumnsVisible(["payee"], wide);
    api.applyColumnState({
      state: wide
        ? [{ colId: "who", width: 140, flex: null }, { colId: "amount", width: 104, flex: null }, { colId: "state", width: 168, flex: null }]
        : [{ colId: "who", flex: 1 }, { colId: "amount", width: 96, flex: null }, { colId: "state", flex: 1 }],
    });
  }, []);

  const onRowClicked = useCallback((e: RowClickedEvent<Row>) => e.data && setOpenId(e.data.id), []);
  const onCellKeyDown = useCallback((e: CellKeyDownEvent<Row>) => {
    const key = (e.event as KeyboardEvent | null)?.key;
    if ((key === "Enter" || key === " ") && e.data) {
      e.event?.preventDefault();
      setOpenId(e.data.id);
    }
  }, []);

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
      <p className="ledger-hint">Click a payment, or press Enter on it, to open its case file and evidence pack.</p>
      <div className="ledger-grid" ref={gridBox}>
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
          rowClass="ledger-row"
          onRowClicked={onRowClicked}
          onCellKeyDown={onCellKeyDown}
          onGridReady={(e) => fit(e.api)}
          onGridSizeChanged={(e) => fit(e.api)}
          overlayNoRowsTemplate='<span>No payments here yet. <a href="/demo">Try one with fake money</a>.</span>'
        />
      </div>
      <CaseDrawer p={open} who={open ? (names[open.spender_id] ?? "Someone") : ""} onClose={() => setOpenId(null)} />
    </section>
  );
}

/** One payment's case file, in a drawer from the right: what happened, why, real shop prices, and where to go next. */
function CaseDrawer({ p, who, onClose }: { p: Payment | null; who: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (p && !d.open) d.showModal();
    if (!p && d.open) d.close();
  }, [p]);

  const s = p ? trackState(p.status) : null;
  const evidence = p && EVIDENCE_FOR.has(p.status) ? `/api/payments/${encodeURIComponent(p.id)}/evidence` : null;
  // The reasons and the price note, minus what the case file below already says.
  const c = p?.case_file ?? null;
  const reasons = p ? unsaidReasons(p.decision?.reasons ?? [], p.decision?.flags ?? p.ai?.flags ?? [], c, { lead: kernelLead(c?.page)?.kind ?? null }) : [];
  const channel3OnCard = !!c && (c.findings.some((f) => f.tool === "find_genuine_offer") || !!c.spot);
  return (
    <dialog
      ref={ref}
      className="ledger-drawer"
      aria-labelledby="ledger-drawer-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {p && s && (
        <div className="ledger-drawer-box">
          <header className="ledger-drawer-head">
            <div>
              <p className="ledger-drawer-kicker">
                {timeAgo(p.created_at)} · {p.request.item ?? p.request.category}
              </p>
              <h2 id="ledger-drawer-title" className="ledger-drawer-title">
                {who} to {p.request.payee.name}, <span className="num">{money(p.amount, p.currency)}</span>
              </h2>
              <span className="feed-state" data-state={s}>
                {STATE_LABEL[s]}
              </span>
            </div>
            <button type="button" className="btn btn-quiet ledger-drawer-close" onClick={onClose} aria-label="Close the case file">
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {s === "failed" && p.error ? (
            <p className="ledger-drawer-why">{p.error}</p>
          ) : reasons.length ? (
            <section aria-labelledby="ledger-why">
              <h3 id="ledger-why" className="ledger-drawer-label">
                Why
              </h3>
              <ul className="ledger-drawer-reasons">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="ledger-drawer-why">Within the rules.</p>
          )}

          {!channel3OnCard && <MarketNote market={p.market} currency={p.currency} />}

          {p.case_file ? (
            <section aria-labelledby="ledger-case">
              <h3 id="ledger-case" className="ledger-drawer-label">
                Case file
              </h3>
              <CaseFile
                c={p.case_file}
                currency={p.currency}
                paymentId={p.id}
                peekScrolls={p.peek_scrolls}
                fold
                settled={p.status !== "needs_approval"}
                real={s === "paid" ? null : realOne(p.case_file, p.market)}
              />
            </section>
          ) : (
            <p className="ledger-drawer-why">
              {EVIDENCE_FOR.has(p.status)
                ? "Spotter couldn't finish a case file for this payment. The reasons above still stand."
                : "No case file: Spotter only opens one for payments it held or stopped."}
            </p>
          )}

          <footer className="ledger-drawer-links">
            <a className="btn btn-quiet" href={`/dashboard#pay-${encodeURIComponent(p.id)}`}>
              See it on the dashboard
            </a>
            {evidence && (
              <>
                <a className="btn btn-quiet" href={evidence} target="_blank" rel="noopener">
                  <FileText size={16} strokeWidth={2} aria-hidden="true" /> Evidence pack<span className="sr-only"> (opens a printable page in a new tab)</span>
                </a>
                <a className="ledger-drawer-txt" href={`${evidence}?format=txt`} download>
                  Plain text copy
                </a>
              </>
            )}
            {(p.paypal_capture_id ?? p.paypal_authorization_id) && (
              <p className="ledger-drawer-id">
                PayPal id <span className="ledger-id">{p.paypal_capture_id ?? p.paypal_authorization_id}</span>
              </p>
            )}
          </footer>
        </div>
      )}
    </dialog>
  );
}
