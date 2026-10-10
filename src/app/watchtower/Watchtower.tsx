"use client";
// Loads AG Studio (about 1.5 MB) in the browser only, on this page only, and keeps it current: every
// 15 seconds while the tab is visible it asks the server what changed, refreshes Studio's data and shows
// a quiet notice ("PayPal confirmed £24.99 released").
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseNote, WatchAlert } from "@/watchtower/data";
import type { RadarCount } from "@/watchtower/widgetLogic";
import { revive, type WireSources } from "@/watchtower/wire";
import type { WatchSnapshot, WatchStore } from "./widgets";
import "./watchtower.css";

const Studio = dynamic(() => import("./Studio"), { ssr: false, loading: () => <div className="wt-loading">Opening Watchtower</div> });

const POLL_MS = 15_000;
const NOTICE_MS = 6_000;

type Board = { sources: WireSources; alerts: WatchAlert[]; notes: CaseNote[]; radar: Record<string, RadarCount>; sampleIds: string[] };

function makeStore(initial: WatchSnapshot): WatchStore & { set(next: Partial<WatchSnapshot>): void } {
  let snap = initial;
  const subs = new Set<() => void>();
  return {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(next) {
      snap = { ...snap, ...next };
      for (const fn of subs) fn();
    },
  };
}

const snapshotOf = (b: Board, canAsk: boolean, version: number): WatchSnapshot => ({
  alerts: b.alerts,
  sampleIds: new Set(b.sampleIds),
  notes: new Map(b.notes.map((n) => [n.id, n])),
  radar: b.radar,
  version,
  canAsk,
});

export function Watchtower({ board, initialState, since }: { board: Board; initialState: unknown; since: string }) {
  const [wire, setWire] = useState(board.sources);
  const [store] = useState(() => makeStore(snapshotOf(board, typeof window !== "undefined" && !window.matchMedia("(max-width: 760px)").matches, 0)));
  const [notices, setNotices] = useState<Array<{ id: number; text: string; tone: "news" | "problem" }>>([]);
  const hadPaypal = useRef(board.sources.paypal !== undefined);
  const sources = useMemo(() => revive(wire), [wire]);
  const nextId = useRef(0);
  const push = useCallback((texts: string[], tone: "news" | "problem") => {
    if (texts.length) setNotices((old) => [...old, ...texts.map((text) => ({ id: ++nextId.current, text, tone }))].slice(-3));
  }, []);
  const notify = useCallback((text: string) => push([text], "problem"), [push]);

  useEffect(() => {
    let last = since;
    let busy = false;
    let failures = 0;
    let stopped = false;
    const failed = (why: unknown) => {
      console.warn("[watchtower] live check failed:", why);
      if (++failures === 3) notify("Watchtower can't reach Spotter right now, so the board may be out of date.");
    };
    const check = async () => {
      if (busy || stopped || document.hidden) return;
      busy = true;
      try {
        const res = await fetch(`/api/watchtower/live?since=${encodeURIComponent(last)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as (Partial<Board> & { changed?: boolean; now?: string; notices?: string[]; error?: string }) | null;
        if (res.status === 401) {
          stopped = true;
          notify("You've been signed out, so Watchtower stopped updating. Refresh the page.");
          return;
        }
        if (!res.ok || !body?.now) return failed(body?.error ?? res.status);
        failures = 0;
        last = body.now;
        if (!body.changed || !body.sources) return;
        // Studio can't gain or lose a source after it loads, so the PayPal source keeps its first shape.
        const next = { ...body.sources };
        if (hadPaypal.current && !next.paypal) next.paypal = [];
        if (!hadPaypal.current) delete next.paypal;
        setWire(next);
        store.set({ ...snapshotOf(body as Board, store.get().canAsk, store.get().version + 1) });
        push(body.notices ?? [], "news");
      } catch (e) {
        failed(e);
      } finally {
        busy = false;
      }
    };
    const id = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [since, store, push, notify]);

  useEffect(() => {
    if (!notices.length) return;
    const t = setTimeout(() => setNotices((old) => old.slice(1)), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notices]);

  return (
    <div className="wt-frame">
      <Studio sources={sources} initialState={initialState} store={store} notify={notify} />
      <ol className="wt-notices" role="status" aria-live="polite">
        {notices.map((x) => (
          <li key={x.id} className="wt-notice" data-tone={x.tone}>
            <span className="wt-notice-dot" aria-hidden="true" />
            {x.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
