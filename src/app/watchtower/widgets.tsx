"use client";
// Spotter's own Studio widgets. Each one draws a piece of the hold track, Spotter's one visual idea:
// money travelling from the spender to the payee, paused at a checkpoint when something looks off.
// They read data through Studio, so page filters, cross filters and the AI agents all work on them.
import { useEffect, useRef, useState } from "react";
import type { AgBaseRegistry, AgBaseWidgetDefinition, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetParams } from "ag-studio";
import type { WatchAlert } from "@/watchtower/data";

export type MoneyKeptDef = { type: "money-kept"; dataMapping: { value: AgWidgetFieldReference[] }; format?: AgWidgetDataFormat<unknown> };
export type HoldTrackDef = { type: "hold-track"; dataMapping: { category: AgWidgetFieldReference[]; value: AgWidgetFieldReference[] }; format?: AgWidgetDataFormat<unknown> };
export type WatchAlertsDef = { type: "watch-alerts"; dataMapping: Record<string, never>; format?: AgWidgetDataFormat<unknown> };

export interface SpotterRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgBaseWidgetDefinition<"money-kept", MoneyKeptDef>
    | AgBaseWidgetDefinition<"hold-track", HoldTrackDef>
    | AgBaseWidgetDefinition<"watch-alerts", WatchAlertsDef>
  )[];
}

export type WatchContext = { alerts: WatchAlert[]; sampleIds: Set<string> };

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

type Field = { key: string };

export function MoneyKeptWidget({ dataMapping, widgetApi }: AgWidgetParams<MoneyKeptDef>) {
  const [value, setValue] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(false);
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
  }, [dataMapping, widgetApi]);

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

export function HoldTrackWidget({ dataMapping, widgetApi }: AgWidgetParams<HoldTrackDef>) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [failed, setFailed] = useState(false);
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
  }, [dataMapping, widgetApi]);

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
            <button type="button" className="wt-stop" onClick={() => pick(s.outcome)} aria-label={`Filter the dashboard to ${s.label}`}>
              <span className="wt-stop-count">{counts?.[s.outcome] ?? 0}</span>
              <span className="wt-stop-dot" aria-hidden="true" />
              <span className="wt-stop-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WatchAlertsWidget({ context, widgetApi }: AgWidgetParams<WatchAlertsDef>) {
  const ctx = context as WatchContext | undefined;
  const alerts = ctx?.alerts ?? [];
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
  return (
    <ul className="wt-alerts">
      {alerts.map((a) => (
        <li key={a.id} className="wt-alert" data-level={a.level}>
          <span className="wt-alert-pin" aria-hidden="true" />
          <div>
            <p className="wt-alerts-title">
              {a.title}
              {a.paymentIds.every((id) => ctx?.sampleIds.has(id)) && <span className="wt-sample-tag">Sample</span>}
            </p>
            <p className="wt-alerts-detail">{a.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
