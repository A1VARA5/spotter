"use client";
// The month without Spotter: the family's month replayed a day at a time on two hold tracks. On the real
// one, money Spotter stepped in on stops at the checkpoint. On the faint ghost track below, the same money
// carries on to the payee, which is what would have happened without it. Motion is transform and opacity
// only, short and ease out, and stops when the widget is off screen. With reduced motion there is no
// travel: the end state shows, with a day by day step control.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgWidgetParams } from "ag-studio";
import { includesSample, replayDays, type ReplayRow } from "@/watchtower/widgetLogic";
import { SampleIncluded, usePaymentRows, useScrollBox, useWatch, type ReplayDef } from "./widgets";

const FIELDS = ["when", "amount", "outcome", "who", "payee", "sample"] as const;
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const BUSY_DAY_MS = 900;
const QUIET_DAY_MS = 160;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function ReplayWidget(p: AgWidgetParams<ReplayDef>) {
  const { version } = useWatch(p.context);
  const { rows, failed } = usePaymentRows(p as never, FIELDS, version);
  const reduced = useReducedMotion();
  const days = useMemo(() => {
    const clean: ReplayRow[] = (rows ?? []).flatMap((r) => {
      const when = r.when instanceof Date ? r.when : new Date(String(r.when));
      const amount = Number(r.amount);
      return Number.isFinite(when.getTime()) && Number.isFinite(amount) ? [{ when, amount, outcome: String(r.outcome), who: String(r.who ?? ""), payee: String(r.payee ?? "") }] : [];
    });
    return replayDays(clean, new Date());
  }, [rows]);

  const last = Math.max(days.length - 1, 0);
  const [index, setIndex] = useState<number | null>(null); // null = the end state
  const [playing, setPlaying] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const scroll = useScrollBox(root);
  const at = index ?? last;

  // Pause when scrolled away; carry on when back.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !onScreen || reduced) return;
    if (at >= last) {
      setPlaying(false);
      return;
    }
    const wait = days[at]?.events.length ? BUSY_DAY_MS : QUIET_DAY_MS;
    const t = setTimeout(() => setIndex(at + 1), wait);
    return () => clearTimeout(t);
  }, [playing, onScreen, reduced, at, last, days]);

  if (failed) return <p className="wt-widget-error">Couldn&apos;t load the month. Reload the page.</p>;
  if (!rows) return null;
  if (!days.length) {
    return (
      <div className="wt-rp wt-rp-empty">
        <p className="wt-rp-title">Nothing to replay yet</p>
        <p className="wt-rp-note">Once your family has payments, this replays the month with and without Spotter.</p>
      </div>
    );
  }

  const today = days[at]!;
  const done = at >= last && index === null;
  const play = () => {
    setIndex(0);
    setPlaying(true);
  };
  const toggle = () => {
    if (playing) setPlaying(false);
    else if (at >= last) play();
    else setPlaying(true);
  };
  const scrub = (n: number) => {
    setPlaying(false);
    setIndex(n >= last ? null : n);
  };
  const end = days[last]!;
  const sofar = days.slice(0, at + 1).flatMap((d) => d.events);
  const heldBack = sofar.filter((e) => e.outcome !== "Protected").length;

  return (
    <div className="wt-rp" role="region" aria-label="The month with and without Spotter" {...scroll} data-reduced={reduced || undefined}>
      <div className="wt-rp-bar">
        {reduced ? (
          <div className="wt-rp-steps">
            <button type="button" className="wt-rp-btn" onClick={() => scrub(Math.max(at - 1, 0))} disabled={at === 0}>
              Previous day
            </button>
            <button type="button" className="wt-rp-btn" onClick={() => scrub(Math.min(at + 1, last))} disabled={at >= last}>
              Next day
            </button>
          </div>
        ) : (
          <button type="button" className="wt-rp-btn wt-rp-play" onClick={toggle} aria-pressed={playing}>
            <span className="wt-rp-icon" data-state={playing ? "pause" : "play"} aria-hidden="true" />
            {playing ? "Pause" : at >= last ? "Replay the month" : "Play"}
          </button>
        )}
        <label className="wt-rp-scrub">
          <span className="wt-rp-day">{day.format(today.date)}</span>
          <input type="range" min={0} max={last} step={1} value={at} onChange={(e) => scrub(Number(e.target.value))} aria-label="Day of the month" aria-valuetext={day.format(today.date)} />
        </label>
      </div>

      <div className="wt-rp-tracks">
        <Track kind="real" label="With Spotter" events={today.events} dayKey={at} animate={!reduced && playing} tally={heldBack ? `${heldBack} held back` : ""} />
        <Track kind="ghost" label="Without Spotter" events={today.events} dayKey={at} animate={!reduced && playing} tally={sofar.length ? `${sofar.length} reached the payee` : ""} />
      </div>

      <div className="wt-rp-counts" aria-live={playing ? "off" : "polite"}>
        <p className="wt-rp-count" data-kind="kept">
          <span className="wt-rp-num">{gbp.format(today.kept)}</span>
          <span className="wt-rp-cap">kept so far</span>
        </p>
        <p className="wt-rp-count" data-kind="gone">
          <span className="wt-rp-num">{gbp.format(today.gone)}</span>
          <span className="wt-rp-cap">would have gone</span>
        </p>
        <SampleIncluded on={includesSample(rows)} />
      </div>
      {done && (
        <p className="wt-rp-note">
          This month Spotter kept {gbp.format(end.kept)}. Without it, {gbp.format(end.gone)} would have left
          {end.protectedSoFar > 0 ? `, ${gbp.format(end.protectedSoFar)} of it with no buyer protection` : ""}.
        </p>
      )}
    </div>
  );
}

function Track({ kind, label, events, dayKey, animate, tally }: { kind: "real" | "ghost"; label: string; events: Array<{ amount: number; outcome: string; who: string; payee: string }>; dayKey: number; animate: boolean; tally: string }) {
  return (
    <div className="wt-rp-track" data-kind={kind}>
      <span className="wt-rp-label">{label}</span>
      <div className="wt-rp-lane">
        <span className="wt-rp-end wt-rp-from">Family</span>
        <span className="wt-rp-line" aria-hidden="true" />
        {kind === "real" && <span className="wt-rp-check" aria-hidden="true" />}
        <span className="wt-rp-end wt-rp-to">Payees</span>
        {tally && <span className="wt-rp-tally">{tally}</span>}
        {events.slice(0, 3).map((e, i) => (
          // Keyed by day so each day's money travels once; a wrapper the width of the lane is what moves.
          <span key={`${dayKey}-${i}`} className="wt-rp-run" data-animate={animate || undefined} data-outcome={e.outcome} style={{ ["--i" as string]: i }}>
            <span className="wt-rp-chip" title={`${e.who} to ${e.payee}`}>
              {gbp.format(e.amount)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
