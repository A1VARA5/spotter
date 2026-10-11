"use client";
// The shared live price watch in the Price watches dialog (demo families only): one real product that Channel3
// price tracking follows for every demo family, shown next to the example. Only prices Channel3 returned are shown,
// with when they were last checked. No target and no "nearly paid": nobody in the family tried to buy it.
import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import type { SharedWatchView } from "@/core/shared-watch";
import { HistoryChart } from "./PriceWatch";
import { money } from "./format";
import { plainError, readJson } from "./http";
import "./pricewatch.css";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const FILLS_IN = "Channel3 adds a point each day, so the line fills in over the next few days.";
const FRESH_MS = 3 * 24 * 60 * 60 * 1000;

/** "Fills in over the next few days" is only promised for the first 3 days of tracking (measured to the last check). */
function stillFilling(v: SharedWatchView): boolean {
  if (!v.trackingSince) return true;
  const ref = Date.parse(v.lastCheckedAt ?? v.trackingSince);
  return ref - Date.parse(v.trackingSince) < FRESH_MS;
}

/** One honest sentence about the price history line. Today's shop prices are a separate, real reading shown above it.
 *  A change is only named when the history's own first and last points differ. */
export function sharedSummary(v: SharedWatchView): string {
  const pts = v.points;
  const filling = stillFilling(v);
  if (pts.length === 0) {
    if (!filling) return `Channel3 hasn't added a ${v.currency} price point since tracking started on ${day(v.trackingSince!)}.`;
    return v.trackingSince ? `Tracking started ${day(v.trackingSince)}. ${FILLS_IN}` : FILLS_IN;
  }
  const first = pts[0]!;
  const last = pts.at(-1)!;
  if (pts.length === 1) {
    const then = filling ? FILLS_IN : `Channel3 hasn't added another ${v.currency} point since.`;
    return `The price history has its first point on ${day(first.at)}: ${money(first.price, v.currency)}. ${then}`;
  }
  const diff = last.price - first.price;
  if (diff < 0) return `The tracked price is down ${money(-diff, v.currency)} since ${day(first.at)}, from ${money(first.price, v.currency)} to ${money(last.price, v.currency)}.`;
  if (diff > 0) return `The tracked price is up ${money(diff, v.currency)} since ${day(first.at)}, from ${money(first.price, v.currency)} to ${money(last.price, v.currency)}.`;
  return pts.every((p) => p.price === first.price)
    ? `No change: ${money(first.price, v.currency)} at every price Channel3 recorded since ${day(first.at)}.`
    : `No change overall: back to ${money(last.price, v.currency)}, the same as on ${day(first.at)}.`;
}

export function SharedWatchPanel({ view: v, error }: { view: SharedWatchView | null; error: string | null }) {
  if (!v) {
    return error ? (
      <p className="error-line" role="alert">
        {error}
      </p>
    ) : (
      <p className="feed-meta" role="status">
        Asking Channel3 for the latest prices...
      </p>
    );
  }
  const tracked = v.trackingSince !== null;
  const pts = v.points;
  const latest = pts.at(-1);
  const prices = pts.map((p) => p.price);
  // Today's headline: the cheapest UK shop at the last listing check (a real reading), else the newest history point.
  const shopsBehind = !!v.shopsCheckedAt && !!v.lastCheckedAt && day(v.shopsCheckedAt) !== day(v.lastCheckedAt) && v.shops.length > 0;
  const lowest = v.shops.reduce<SharedWatchView["shops"][number] | null>((m, s) => (!m || s.price < m.price ? s : m), null);
  return (
    <article className="pw pw-shared" data-state={tracked ? "watching" : "starting"} aria-labelledby="pw-shared-title">
      <header className="pw-head">
        <h3 id="pw-shared-title" className="pw-item">
          {v.item}
        </h3>
        {tracked ? (
          <span className="pw-badge" data-tone="live">
            {v.label}
          </span>
        ) : (
          <span className="pw-badge">Shared demo watch</span>
        )}
      </header>
      <p className="pw-shared-note">
        <Radio size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>
          Shared by every demo family, to show real price tracking working. Nobody in your family nearly paid for it, and Spotter never buys it.
        </span>
      </p>
      {!tracked ? (
        <p className="pw-result">
          <span>
            Channel3 tracking hasn&apos;t started yet.{" "}
            {v.problem === "not_found"
              ? "Channel3 says it can't track this product, so there are no prices to show."
              : v.problem
                ? "Channel3 didn't answer, so Spotter tries again within the hour."
                : "Spotter is starting it now. Open this again in a moment."}
          </span>
        </p>
      ) : (
        <>
          {(lowest || latest) && (
            <dl className="pw-compare">
              {lowest ? (
                <div className="pw-now">
                  <dt>Lowest price at UK shops</dt>
                  <dd className="pw-price num">{money(lowest.price, v.currency)}</dd>
                  <dd className="pw-where">
                    at {lowest.shop}
                    {v.shopsCheckedAt ? `, checked ${day(v.shopsCheckedAt)}` : ""}
                  </dd>
                </div>
              ) : (
                latest && (
                  <div className="pw-now">
                    <dt>Latest price</dt>
                    <dd className="pw-price num">{money(latest.price, v.currency)}</dd>
                    <dd className="pw-where">recorded {day(latest.at)}</dd>
                  </div>
                )
              )}
              <div className="pw-was">
                <dt>Price history</dt>
                {pts.length >= 2 ? (
                  <>
                    <dd className="pw-price num">
                      {money(Math.min(...prices), v.currency)} to {money(Math.max(...prices), v.currency)}
                    </dd>
                    <dd className="pw-where">
                      {pts.length} points since {day(pts[0]!.at)}
                    </dd>
                  </>
                ) : (
                  <>
                    <dd className="pw-price">{pts.length === 1 ? "1 point so far" : "Starting"}</dd>
                    <dd className="pw-where">one point a day</dd>
                  </>
                )}
              </div>
            </dl>
          )}
          <p className="pw-result">
            <span>{sharedSummary(v)}</span>
          </p>
          {shopsBehind && (
            <p className="pw-shared-stale" role="status">
              Shop prices are from {day(v.shopsCheckedAt!)}; the shop listing hasn&apos;t answered since.
            </p>
          )}
          {v.shops.length === 0 && (
            <p className="pw-shops-title">
              {v.shopsCheckedAt ? `No UK shop listed it at the last check (${day(v.shopsCheckedAt)}).` : "Shop prices haven't loaded yet."}
            </p>
          )}
          {v.shops.length > 0 && (
            <div className="pw-shops">
              <p className="pw-shops-title">UK shops at the last check{v.shopsCheckedAt ? ` (${day(v.shopsCheckedAt)})` : ""}</p>
              <ul>
                {v.shops.map((s) => (
                  <li key={s.shop}>
                    <span className="pw-shop">{s.shop}</span>
                    <span className="num">{money(s.price, v.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pts.length >= 2 && <HistoryChart points={pts} currency={v.currency} state="watching" />}
          {v.unreachableAt && (
            <p className="pw-shared-stale" role="status">
              {pts.length === 0
                ? "Channel3 didn't answer just now, so there's no history yet."
                : `Channel3 didn't answer just now, so this is the history ${v.lastCheckedAt ? `last checked on ${day(v.lastCheckedAt)}` : "stored so far"}.`}
            </p>
          )}
        </>
      )}
      <p className="pw-source">
        {v.shops.length > 0 ? "Shop prices and history" : "History"} from Channel3 price tracking{v.trackingSince ? `, tracked since ${day(v.trackingSince)}` : ""}.
        {v.lastCheckedAt ? ` Last checked ${when(v.lastCheckedAt)}.` : ""} Spotter asks again at most once an hour, and every day.
      </p>
    </article>
  );
}

/** Loads the shared watch when the Price watches dialog opens (the server refreshes it at most once an hour). */
export function SharedWatch() {
  const [view, setView] = useState<SharedWatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/watches/shared", { cache: "no-store" })
      .then(async (r) => {
        const j = await readJson(r);
        if (!r.ok || !j.shared) throw new Error(j.error ?? `Couldn't load the shared price watch (${r.status}).`);
        if (live) setView(j.shared as SharedWatchView);
      })
      .catch((e: unknown) => {
        console.warn("[spotter] shared price watch didn't load:", e);
        if (live) setError(plainError(e));
      });
    return () => {
      live = false;
    };
  }, []);
  return <SharedWatchPanel view={view} error={error} />;
}
