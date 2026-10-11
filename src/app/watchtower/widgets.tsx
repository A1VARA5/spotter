"use client";
// Spotter's own Studio widgets. Each one draws a piece of the hold track, Spotter's one visual idea:
// money travelling from the spender to the payee, paused at a checkpoint when something looks off.
// They read data through Studio, so page filters, cross filters and the AI agents all work on them.
// Payee names come from outside the family: they are only ever rendered as plain text.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgBaseRegistry, AgBaseWidgetDefinition, AgWidgetApi, AgWidgetDataFormat, AgWidgetField, AgWidgetFieldReference, AgWidgetParams } from "ag-studio";
import type { CaseNote, WatchAlert } from "@/watchtower/data";
import type { GranLabels } from "@/watchtower/gran";
import type { GranLang } from "@/watchtower/granLang";
import type { GranSafeDef, GranScamsDef, GranWaitingDef } from "./GranWidgets";
import type { AiChecksDef } from "./AiChecks";
import type { ReceiptBook } from "./ReceiptBar";
import { countdown, fairPrice, firstFew, pickCase, poundsShort, radarLines, shortId, watchSummary, type PriceItem, type RadarCount } from "@/watchtower/widgetLogic";

export type MoneyKeptDef = { type: "money-kept"; dataMapping: { value: AgWidgetFieldReference[] }; format?: AgWidgetDataFormat<unknown> };
export type HoldTrackDef = { type: "hold-track"; dataMapping: { category: AgWidgetFieldReference[]; value: AgWidgetFieldReference[] }; format?: AgWidgetDataFormat<unknown> };
type NoMapping<T extends string> = { type: T; dataMapping: Record<string, never>; format?: AgWidgetDataFormat<unknown> };
export type WatchAlertsDef = NoMapping<"watch-alerts">;
export type MoneyMidAirDef = NoMapping<"money-mid-air">;
export type ReplayDef = NoMapping<"replay">;
export type ScamRadarDef = NoMapping<"scam-radar">;
export type CaseFileDef = NoMapping<"case-file">;
export type FairPriceDef = NoMapping<"fair-price">;
export type PriceWatchesDef = NoMapping<"price-watches">;

export interface SpotterRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgBaseWidgetDefinition<"money-kept", MoneyKeptDef>
    | AgBaseWidgetDefinition<"hold-track", HoldTrackDef>
    | AgBaseWidgetDefinition<"watch-alerts", WatchAlertsDef>
    | AgBaseWidgetDefinition<"money-mid-air", MoneyMidAirDef>
    | AgBaseWidgetDefinition<"replay", ReplayDef>
    | AgBaseWidgetDefinition<"scam-radar", ScamRadarDef>
    | AgBaseWidgetDefinition<"case-file", CaseFileDef>
    | AgBaseWidgetDefinition<"fair-price", FairPriceDef>
    | AgBaseWidgetDefinition<"gran-safe", GranSafeDef>
    | AgBaseWidgetDefinition<"gran-waiting", GranWaitingDef>
    | AgBaseWidgetDefinition<"gran-scams", GranScamsDef>
    | AgBaseWidgetDefinition<"price-watches", PriceWatchesDef>
    | AgBaseWidgetDefinition<"ai-checks", AiChecksDef>
  )[];
}

/** What the page knows that isn't in Studio's data: code made alerts, case notes, network counts. */
export type WatchSnapshot = {
  alerts: WatchAlert[];
  sampleIds: Set<string>;
  notes: Map<string, CaseNote>;
  radar: Record<string, RadarCount>;
  /** Bumped when the live poll brings new data, so widgets fetch again. */
  version: number;
  /** False on phones (view mode has no AI panel). */
  canAsk: boolean;
};
export type WatchStore = { get(): WatchSnapshot; subscribe(fn: () => void): () => void };
/** Studio's `context` is read once, so it carries a store the page updates rather than the values. */
export type WatchContext = { store: WatchStore; lookInto(alert: WatchAlert): Promise<void>; gran?: GranLabels; granLang?: GranLang; receipts?: ReceiptBook };

/**
 * Widgets scroll inside their tile when the text is longer than the tile. A scrolling box has to be
 * reachable by keyboard (WCAG 2.1.1), so it becomes a tab stop, but only while it actually overflows:
 * a tile that fits doesn't add a pointless stop. Also marks the box so CSS can show a scroll cue.
 */
export function useScrollBox<T extends HTMLElement>(given?: React.RefObject<T | null>) {
  const own = useRef<T>(null);
  const ref = given ?? own;
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  });
  return { ref, tabIndex: over ? 0 : undefined, "data-scroll": over || undefined } as const;
}

const EMPTY: WatchSnapshot = { alerts: [], sampleIds: new Set(), notes: new Map(), radar: {}, version: 0, canAsk: false };
export function useWatch(context: unknown): WatchSnapshot {
  const store = (context as WatchContext | undefined)?.store;
  return useSyncExternalStore(store?.subscribe ?? (() => () => {}), store?.get ?? (() => EMPTY), () => EMPTY);
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

type Field = { key: string };

export function MoneyKeptWidget({ dataMapping, widgetApi, context }: AgWidgetParams<MoneyKeptDef>) {
  const [value, setValue] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(false);
  const { version } = useWatch(context);
  useEffect(() => {
    let live = true;
    const field = dataMapping.value?.at(0) as (AgWidgetFieldReference & Field) | undefined;
    if (!field) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading", { prominent: !loaded.current });
    widgetApi
      .getData({ fields: [field] as never })
      .then((res) => {
        if (!live) return;
        const row = res.results.rows.at(0);
        if (!row) return widgetApi.setDisplayState("noData");
        // No stopped payments sums to null, which really is £0. Anything else that isn't a number is a bug.
        const v = row[field.key] == null ? 0 : Number(row[field.key]);
        if (!Number.isFinite(v)) throw new Error(`money kept came back as ${String(row[field.key])}`);
        loaded.current = true;
        setFailed(false);
        setValue(v);
        widgetApi.setDisplayState("displayed");
      })
      .catch((e: unknown) => {
        if (!live) return;
        console.error("[watchtower] money kept widget:", e);
        setFailed(true);
        widgetApi.setDisplayState("displayed");
      });
    return () => {
      live = false;
    };
  }, [dataMapping, widgetApi, version]);

  return (
    <div className="wt-kept">
      <p className="wt-kept-label">Money Spotter kept</p>
      {failed ? <p className="wt-widget-error">Couldn&apos;t add this up. Reload the page.</p> : <p className="wt-kept-amount">{value === null ? "" : gbp.format(value)}</p>}
      <div className="wt-kept-track" aria-hidden="true">
        <span className="wt-kept-line" />
        <span className="wt-kept-stop" />
        <span className="wt-kept-line wt-kept-line-dead" />
      </div>
      <p className="wt-kept-note">Stopped or denied before it reached a scammer.</p>
    </div>
  );
}

// The track's stops, in the order money meets them.
const STOPS: Array<{ outcome: string; label: string; tone: string }> = [
  { outcome: "Paid", label: "Paid", tone: "go" },
  { outcome: "Protected", label: "Protected", tone: "protect" },
  { outcome: "Waiting", label: "Waiting for you", tone: "hold" },
  { outcome: "Denied", label: "Denied", tone: "stop" },
  { outcome: "Stopped", label: "Stopped", tone: "stop" },
];

const KNOWN = new Set(STOPS.map((s) => s.outcome));

export function HoldTrackWidget({ dataMapping, widgetApi, context }: AgWidgetParams<HoldTrackDef>) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [failed, setFailed] = useState(false);
  const { version } = useWatch(context);
  const cat = dataMapping.category?.at(0) as (AgWidgetFieldReference & Field) | undefined;
  useEffect(() => {
    let live = true;
    const val = dataMapping.value?.at(0) as (AgWidgetFieldReference & Field) | undefined;
    if (!cat || !val) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading", { prominent: counts === null });
    widgetApi
      .getData({ fields: [cat, val] as never })
      .then((res) => {
        if (!live) return;
        const next: Record<string, number> = {};
        for (const r of res.results.rows) {
          const outcome = String(r[cat.key]);
          const n = Number(r[val.key] ?? 0);
          if (!KNOWN.has(outcome)) console.warn(`[watchtower] hold track has no stop for "${outcome}"`);
          else if (Number.isFinite(n)) next[outcome] = n;
          else console.warn(`[watchtower] hold track got a non number for "${outcome}": ${String(r[val.key])}`);
        }
        setFailed(false);
        setCounts(next);
        widgetApi.setDisplayState(res.results.rows.length ? "displayed" : "noData");
      })
      .catch((e: unknown) => {
        if (!live) return;
        console.error("[watchtower] hold track widget:", e);
        setFailed(true);
        widgetApi.setDisplayState("displayed");
      });
    return () => {
      live = false;
    };
    // counts is read only for the first spinner
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataMapping, widgetApi, version]);

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  if (failed) return <p className="wt-widget-error">Couldn&apos;t load the hold track. Reload the page.</p>;
  const pick = (outcome: string) => {
    if (!cat) return;
    widgetApi.toggleCrossFilter({ type: "multiValue", values: [{ field: cat, value: outcome }], group: 0 } as never);
  };

  return (
    <div className="wt-track">
      <div className="wt-track-ends">
        <span>Asked to pay</span>
        <span>{total === 1 ? "1 payment" : `${total} payments`}</span>
      </div>
      <ol className="wt-track-stops">
        {STOPS.map((s) => (
          <li key={s.outcome} data-tone={s.tone}>
            {/* The name starts with the visible text ("22 Paid") so voice control users can say what they see (WCAG 2.5.3). */}
            <button type="button" className="wt-stop" onClick={() => pick(s.outcome)}>
              <span className="wt-stop-count">{counts?.[s.outcome] ?? 0}</span>
              <span className="wt-stop-dot" aria-hidden="true" />
              <span className="wt-stop-label">{s.label}</span>
              <span className="wt-sr">, filter the board to these</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WatchAlertsWidget({ context, widgetApi }: AgWidgetParams<WatchAlertsDef>) {
  const ctx = context as WatchContext | undefined;
  const { alerts, sampleIds, canAsk } = useWatch(context);
  const [asking, setAsking] = useState<string | null>(null);
  const scroll = useScrollBox<HTMLUListElement>();
  useEffect(() => {
    widgetApi.setDisplayState("displayed");
  }, [widgetApi]);
  if (!alerts.length) {
    return (
      <div className="wt-alerts wt-alerts-empty">
        <p className="wt-alerts-title">All quiet</p>
        <p className="wt-alerts-detail">Nothing unusual this month. Spotter checks again every time someone pays.</p>
      </div>
    );
  }
  const ask = async (a: WatchAlert) => {
    if (!ctx) return;
    setAsking(a.id);
    try {
      await ctx.lookInto(a);
    } finally {
      setAsking(null);
    }
  };
  const { shown, more } = firstFew(alerts, ALERTS_SHOWN);
  return (
    <ul className="wt-alerts" aria-label="Watch alerts" {...scroll}>
      {shown.map((a) => (
        <li key={a.id} className="wt-alert" data-level={a.level}>
          <span className="wt-alert-pin" aria-hidden="true" />
          <div>
            <p className="wt-alerts-title">
              {a.title}
              {a.paymentIds.every((id) => sampleIds.has(id)) && <span className="wt-sample-tag">Sample</span>}
            </p>
            <p className="wt-alerts-detail">{a.detail}</p>
            {canAsk && (
              <button type="button" className="wt-look" onClick={() => void ask(a)} disabled={asking !== null}>
                {asking === a.id ? "Opening the assistant" : "Look into this"}
              </button>
            )}
          </div>
        </li>
      ))}
      {more > 0 && (
        <li className="wt-more">
          {more === 1 ? "1 more alert" : `${more} more alerts`} this month. Every payment is in <a href="/ledger">Activity</a>.
        </li>
      )}
    </ul>
  );
}

// ---------- reading Spotter's fields without a data mapping ----------

/** The schema's own field objects for `table.<id>`, so getData accepts them. Null if any is missing. */
function fieldsOf(widgetApi: AgWidgetApi, table: string, ids: readonly string[]): Record<string, AgWidgetField> | null {
  const t = widgetApi.getSchema().find((s) => s.id === table);
  if (!t) return null;
  const out: Record<string, AgWidgetField> = {};
  for (const id of ids) {
    const f = t.fields.find((x) => x.fieldId === `${table}.${id}` || x.fieldId === id || x.key === id);
    if (!f) return null;
    out[id] = f;
  }
  return out;
}

type Row = Record<string, unknown>;

/**
 * Rows of the payments table with the given fields, with the page's filters, this widget's filters and
 * any cross filter applied by Studio. Values come back keyed by our own field ids. Studio hands a widget
 * new params whenever a filter changes, so the params object itself is what triggers a fresh query.
 */
export function usePaymentRows(params: AgWidgetParams<never>, ids: readonly string[], version: number): { rows: Row[] | null; failed: boolean } {
  return useTableRows(params, "payments", ids, version);
}

/** The same for any of Watchtower's tables. */
function useTableRows(params: AgWidgetParams<never>, table: string, ids: readonly string[], version: number): { rows: Row[] | null; failed: boolean } {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = useRef(false);
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    const { widgetApi } = params;
    const show = () => {
      if (shown.current) return;
      shown.current = true;
      widgetApi.setDisplayState("displayed");
    };
    const fields = fieldsOf(widgetApi, table, key.split(","));
    if (!fields) {
      console.error(`[watchtower] ${table} table is missing one of ${key}`);
      setFailed(true);
      show();
      return;
    }
    widgetApi
      .getData({ fields: Object.values(fields) })
      .then((res) => {
        if (!live) return;
        setRows(res.results.rows.map((r) => Object.fromEntries(Object.entries(fields).map(([id, f]) => [id, r[f.key]]))));
        setFailed(false);
        show();
      })
      .catch((e: unknown) => {
        if (!live) return;
        console.error(`[watchtower] couldn't read ${table}:`, e);
        setFailed(true);
        show();
      });
    return () => {
      live = false;
    };
  }, [params, table, key, version]);
  return { rows, failed };
}

const asDate = (v: unknown) => (v instanceof Date ? v : v == null || v === "" ? null : new Date(v as string));
const asNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const asText = (v: unknown) => (v == null ? "" : String(v));

/** Re-renders every `ms` while the tab is visible, for countdowns. */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ---------- money in mid air ----------

const AIR_FIELDS = ["id", "when", "who", "payee", "amount", "outcome", "heldAtPayPal", "paypalExpires", "paypalId", "sample"] as const;

export function MoneyMidAirWidget(p: AgWidgetParams<MoneyMidAirDef>) {
  const { context } = p;
  const { version } = useWatch(context);
  const { rows, failed } = usePaymentRows(p as never, AIR_FIELDS, version);
  const now = useTick(30_000);
  const scroll = useScrollBox<HTMLDivElement>();
  if (failed) return <p className="wt-widget-error">Couldn&apos;t read what PayPal is holding. Reload the page.</p>;
  if (!rows) return null;
  const held = rows.filter((r) => r.outcome === "Waiting").sort((a, b) => (asDate(a.when)?.getTime() ?? 0) - (asDate(b.when)?.getTime() ?? 0));
  // Filtered to one stopped payment (an incident page): show that it never left.
  const turnedBack = !held.length && rows.length <= 3 ? rows.filter((r) => r.outcome === "Stopped" || r.outcome === "Denied") : [];
  const total = held.reduce((t, r) => t + asNum(r.heldAtPayPal), 0);

  if (!held.length && !turnedBack.length) {
    return (
      <div className="wt-air wt-air-empty">
        <p className="wt-air-total">Nothing held at PayPal right now</p>
        <p className="wt-air-note">When Spotter holds a payment for you, the money waits here inside PayPal, with PayPal&apos;s own countdown.</p>
      </div>
    );
  }
  return (
    <div className="wt-air" role="region" aria-label="Money held at PayPal" {...scroll}>
      {held.length > 0 && (
        <p className="wt-air-total">
          <span className="wt-air-sum">{gbp.format(total)}</span> held at PayPal right now
        </p>
      )}
      <ul className="wt-air-list">
        {held.map((r) => {
          const c = countdown(asDate(r.paypalExpires), asDate(r.when) ?? new Date(now), new Date(now));
          return (
            <li key={asText(r.id)} className="wt-air-item">
              <p className="wt-air-who">
                <span>{asText(r.who)}</span>
                <span className="wt-air-arrow" aria-hidden="true">
                  {" "}
                  to{" "}
                </span>
                <span className="wt-air-payee">{asText(r.payee)}</span>
                {r.sample === "Yes" && <span className="wt-sample-tag">Sample</span>}
              </p>
              <div className="wt-air-track" aria-hidden="true">
                <span className="wt-air-line" />
                <span className="wt-air-clamp">{gbp.format(asNum(r.amount))}</span>
                <span className="wt-air-line wt-air-line-ahead" />
              </div>
              <div className="wt-air-clock" aria-hidden="true">
                <span className="wt-air-clock-fill" style={{ transform: `scaleX(${c.elapsed})` }} />
              </div>
              <p className="wt-air-note" data-expired={c.expired || undefined}>
                {c.expired ? c.text : `Held at PayPal, ${c.text}`}
                {r.paypalId ? <span className="wt-air-id"> · Authorisation {shortId(asText(r.paypalId))}</span> : null}
              </p>
            </li>
          );
        })}
        {turnedBack.map((r) => (
          <li key={asText(r.id)} className="wt-air-item" data-turned="back">
            <p className="wt-air-who">
              <span>{asText(r.who)}</span> to <span className="wt-air-payee">{asText(r.payee)}</span>
            </p>
            <div className="wt-air-track" aria-hidden="true">
              <span className="wt-air-line" />
              <span className="wt-air-stop" />
              <span className="wt-air-line wt-air-line-dead" />
            </div>
            <p className="wt-air-note">
              {gbp.format(asNum(r.amount))} {r.outcome === "Denied" ? "denied. PayPal released the hold, nothing was paid." : "stopped by Spotter before any money moved."}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- scam radar ----------

const RADAR_FIELDS = ["payee", "outcome"] as const;
// How many rows a tile shows before "N more": enough to read, few enough to fit the tile at laptop width.
const RADAR_SHOWN = 3;
const FAIR_SHOWN = 1;
const ALERTS_SHOWN = 2;

export function ScamRadarWidget(p: AgWidgetParams<ScamRadarDef>) {
  const { context } = p;
  const { version, radar } = useWatch(context);
  const { rows, failed } = usePaymentRows(p as never, RADAR_FIELDS, version);
  const scroll = useScrollBox<HTMLUListElement>();
  if (failed) return <p className="wt-widget-error">Couldn&apos;t load the scam radar. Reload the page.</p>;
  if (!rows) return null;
  const lines = radarLines(rows.map((r) => ({ payee: asText(r.payee), outcome: asText(r.outcome) })), radar);
  if (!lines.length) {
    return (
      <div className="wt-radar wt-radar-empty">
        <p className="wt-radar-payee">Nobody stopped here yet</p>
        <p className="wt-radar-text">When Spotter stops a payee for your family, this shows how many other Spotter families stopped them too.</p>
      </div>
    );
  }
  const { shown, more } = firstFew(lines, RADAR_SHOWN);
  return (
    <ul className="wt-radar" aria-label="Scam radar" {...scroll}>
      {shown.map((l) => (
        <li key={l.payee} className="wt-radar-row">
          <div className="wt-radar-head">
            <p className="wt-radar-payee" title={l.payee}>
              {l.payee}
            </p>
            {l.sample && <span className="wt-sample-tag">Sample</span>}
          </div>
          <div className="wt-radar-marks" aria-hidden="true">
            {Array.from({ length: Math.min(l.families, 8) }, (_, i) => (
              <span key={i} className="wt-radar-mark" />
            ))}
            {l.families > 8 && <span className="wt-radar-more">+{l.families - 8}</span>}
            {l.families === 0 && <span className="wt-radar-mark wt-radar-mark-none" />}
          </div>
          <p className="wt-radar-text">{l.text}</p>
        </li>
      ))}
      {more > 0 && (
        <li className="wt-more">
          {more === 1 ? "1 more payee" : `${more} more payees`} Spotter stopped this month, in <a href="/ledger">Activity</a>.
        </li>
      )}
    </ul>
  );
}

// ---------- case file ----------

const CASE_FIELDS = ["id", "when", "who", "payee", "amount", "outcome"] as const;

export function CaseFileWidget(p: AgWidgetParams<CaseFileDef>) {
  const { context } = p;
  const { version, notes, sampleIds } = useWatch(context);
  const { rows, failed } = usePaymentRows(p as never, CASE_FIELDS, version);
  const scroll = useScrollBox<HTMLElement>();
  if (failed) return <p className="wt-widget-error">Couldn&apos;t open the case file. Reload the page.</p>;
  if (!rows) return null;
  const id = pickCase(rows.map((r) => ({ id: asText(r.id), when: asDate(r.when) ?? new Date(0), outcome: asText(r.outcome) })));
  const row = rows.find((r) => r.id === id);
  const note = id ? notes.get(id) : undefined;
  if (!row || !note) {
    return (
      <div className="wt-case wt-case-empty">
        <p className="wt-case-headline">No case to show</p>
        <p className="wt-case-meta">Filter this widget to one payment to see Spotter&apos;s reasons and the scam signs it found.</p>
      </div>
    );
  }
  const outcome = asText(row.outcome);
  return (
    <article className="wt-case" data-outcome={outcome} role="region" aria-label={`Case file: ${asText(row.who)} to ${asText(row.payee)}`} {...scroll}>
      <p className="wt-case-meta">
        <span className="wt-case-outcome">{outcome === "Waiting" ? "Waiting for you" : outcome}</span>
        <span>
          {asText(row.who)} to <span className="wt-case-payee">{asText(row.payee)}</span>, {gbp.format(asNum(row.amount))}
        </span>
        {sampleIds.has(asText(row.id)) && <span className="wt-sample-tag">Sample</span>}
      </p>
      <h2 className="wt-case-headline">{note.caseHeadline ?? note.reasons[0] ?? "Spotter checked this payment."}</h2>
      {note.reasons.length > 0 && (
        <section className="wt-case-part">
          <h3>Why Spotter stepped in</h3>
          <ul>
            {note.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      {note.signs.length > 0 && (
        <section className="wt-case-part">
          <h3>Scam signs</h3>
          <ul className="wt-case-signs">
            {note.signs.map((s, i) => (
              <li key={i} data-severity={s.severity}>
                <span className="wt-case-sign">{s.sign}</span> {s.why}
              </li>
            ))}
          </ul>
        </section>
      )}
      {note.caseFindings && note.caseFindings.length > 0 && (
        <section className="wt-case-part">
          <h3>What the case worker found</h3>
          <ul>
            {note.caseFindings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

// ---------- fair price ----------

const PRICE_FIELDS = ["id", "when", "who", "kind", "payee", "amount", "outcome", "marketCheapest", "marketMedian", "priceGap", "marketShop", "marketItem", "sample"] as const;
const asNumOrNull = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const VERDICT_TEXT: Record<PriceItem["verdict"], string> = { fake: "Too cheap to be real", over: "Paid more", under: "Paid less", fair: "Fair price" };

/** Paid against the cheapest and typical real shop price, on one line: the hold track idea for prices. */
function PriceScale({ item }: { item: PriceItem }) {
  const top = Math.max(item.amount, item.median, item.cheapest) * 1.12 || 1;
  const at = (n: number) => `${Math.min(100, Math.max(0, (n / top) * 100))}%`;
  return (
    <div className="wt-fair-scale" aria-hidden="true">
      <span className="wt-fair-line" />
      <span className="wt-fair-mark wt-fair-mark-real" style={{ left: at(item.cheapest) }} />
      <span className="wt-fair-mark wt-fair-mark-median" style={{ left: at(item.median) }} />
      <span className="wt-fair-mark wt-fair-mark-paid" data-verdict={item.verdict} style={{ left: at(item.amount) }} />
    </div>
  );
}

export function FairPriceWidget(p: AgWidgetParams<FairPriceDef>) {
  const { context } = p;
  const { version } = useWatch(context);
  const { rows, failed } = usePaymentRows(p as never, PRICE_FIELDS, version);
  const now = useTick(60_000);
  const scroll = useScrollBox<HTMLDivElement>();
  if (failed) return <p className="wt-widget-error">Couldn&apos;t load the price checks. Reload the page.</p>;
  if (!rows) return null;
  const f = fairPrice(
    rows.map((r) => ({
      id: asText(r.id),
      when: asDate(r.when) ?? new Date(0),
      who: asText(r.who),
      kind: asText(r.kind),
      payee: asText(r.payee),
      amount: asNum(r.amount),
      outcome: asText(r.outcome),
      marketCheapest: asNumOrNull(r.marketCheapest),
      marketMedian: asNumOrNull(r.marketMedian),
      priceGap: asNumOrNull(r.priceGap),
      marketShop: asText(r.marketShop),
      marketItem: asText(r.marketItem),
      sample: r.sample === "Yes",
    })),
    new Date(now),
  );
  if (!f.checked) {
    return (
      <div className="wt-fair wt-fair-empty">
        <p className="wt-fair-label">Fair price</p>
        <p className="wt-fair-headline">No price checks this month yet</p>
        <p className="wt-fair-note">When someone buys a product, Spotter compares the price with real shops and it shows up here.</p>
      </div>
    );
  }
  return (
    <div className="wt-fair" role="region" aria-label="Fair price" {...scroll}>
      <p className="wt-fair-label">Fair price</p>
      <p className="wt-fair-headline">{f.headline}</p>
      {f.caught && <p className="wt-fair-caught">{f.caught}</p>}
      <ul className="wt-fair-list">
        {firstFew(f.items, FAIR_SHOWN).shown.map((i) => (
          <li key={i.id} className="wt-fair-item">
            <p className="wt-fair-what">
              <span className="wt-fair-item-name">{i.marketItem || i.payee}</span>
              <span className="wt-fair-verdict" data-verdict={i.verdict}>
                {VERDICT_TEXT[i.verdict]}
              </span>
              {i.sample && <span className="wt-sample-tag">Sample</span>}
            </p>
            <PriceScale item={i} />
            <p className="wt-fair-note">
              {i.outcome === "Paid" ? "Paid" : `${i.outcome}:`} {poundsShort(i.amount)} at <span className="wt-fair-payee">{i.payee}</span>. Cheapest real shop {poundsShort(i.cheapest)} at{" "}
              <span className="wt-fair-payee">{i.marketShop}</span>
            </p>
          </li>
        ))}
      </ul>
      {f.checked > FAIR_SHOWN && (
        <p className="wt-more">
          {FAIR_SHOWN === 1 ? "The biggest" : `The biggest ${FAIR_SHOWN}`} of {f.checked} price checks this month. Every one is in <a href="/ledger">Activity</a>.
        </p>
      )}
      <p className="wt-fair-source">Real shop prices from Channel3, checked when each payment was made.</p>
    </div>
  );
}

// ---------- price watches ----------

const WATCH_FIELDS = ["id", "who", "item", "status", "nearlyPaid", "target", "bestPrice", "shop", "saving", "example", "sample"] as const;

/** Prices Spotter is watching after a payment was too dear, and the drops it found. It never buys; the spotter decides. */
export function PriceWatchesWidget(p: AgWidgetParams<PriceWatchesDef>) {
  const { version } = useWatch(p.context);
  const { rows, failed } = useTableRows(p as never, "watches", WATCH_FIELDS, version);
  const scroll = useScrollBox<HTMLDivElement>();
  if (failed) return <p className="wt-widget-error">Couldn&apos;t load the price watches. Reload the page.</p>;
  if (!rows) return null;
  const list = rows.map((r) => ({
    id: asText(r.id),
    who: asText(r.who),
    item: asText(r.item),
    status: asText(r.status),
    nearlyPaid: asNum(r.nearlyPaid),
    target: asNum(r.target),
    bestPrice: asNumOrNull(r.bestPrice),
    shop: asText(r.shop),
    saving: asNum(r.saving),
    tag: r.example === "Yes" ? "Example" : r.sample === "Yes" ? "Sample" : "",
  }));
  const s = watchSummary(list);
  if (!list.length) {
    return (
      <div className="wt-fair wt-fair-empty">
        <p className="wt-fair-label">Price watches</p>
        <p className="wt-fair-headline">No price watches yet</p>
        <p className="wt-fair-note">When a payment is too dear, Watch the price on it and Spotter tells you if a real shop sells it for less.</p>
      </div>
    );
  }
  return (
    <div className="wt-fair" role="region" aria-label="Price watches" {...scroll}>
      <p className="wt-fair-label">Price watches</p>
      <p className="wt-fair-headline">{s.headline}</p>
      <ul className="wt-fair-list">
        {list.map((w) => (
          <li key={w.id} className="wt-fair-item">
            <p className="wt-fair-what">
              <span className="wt-fair-item-name">{w.item}</span>
              <span className="wt-fair-verdict" data-verdict={w.status === "Dropped" ? "fair" : w.status === "Watching" ? "over" : undefined}>
                {w.status === "Dropped" ? "Price dropped" : w.status}
              </span>
              {w.tag && <span className="wt-sample-tag">{w.tag}</span>}
            </p>
            <p className="wt-fair-note">
              {w.status === "Dropped" && w.bestPrice !== null ? (
                <>
                  Now {poundsShort(w.bestPrice)} at <span className="wt-fair-payee">{w.shop}</span>
                  {w.saving > 0 ? `, ${poundsShort(w.saving)} less than ${w.who} nearly paid.` : "."}
                </>
              ) : w.status !== "Watching" ? (
                <>
                  {w.who} nearly paid {poundsShort(w.nearlyPaid)}. {w.status === "Expired" ? "Watched for two weeks without a drop." : "No longer watched."}
                </>
              ) : (
                <>
                  {w.who} nearly paid {poundsShort(w.nearlyPaid)}. Spotter tells you at {poundsShort(w.target)} or less
                  {w.bestPrice !== null && w.shop ? (
                    <>
                      ; best real price now {poundsShort(w.bestPrice)} at <span className="wt-fair-payee">{w.shop}</span>.
                    </>
                  ) : (
                    "."
                  )}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="wt-fair-source">Real shop prices from Channel3. Spotter never buys when a price drops; you decide.</p>
    </div>
  );
}
