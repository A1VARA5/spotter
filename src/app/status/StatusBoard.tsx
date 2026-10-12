"use client";
// The status lines, kept fresh: asks /api/health once a minute (the answer is cached for a minute anyway) while the
// tab is visible. Times are counted from when the check ran, so the server and browser render the same words.
import { useEffect, useState } from "react";
import type { HealthReport, Status } from "@/server/health";
import { timeAgo } from "@/ui/format";

const WORD: Record<Status, string> = { ok: "Working", degraded: "Working, with a catch", down: "Down", off: "Not set up" };
const HEADLINE: Record<HealthReport["status"], string> = {
  ok: "Everything is working.",
  degraded: "Spotter is working, with a catch below.",
  down: "Part of Spotter is down right now.",
};

export function StatusBoard({ initial }: { initial: HealthReport | null }) {
  const [report, setReport] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) throw new Error(`health ${r.status}`);
        const next = (await r.json()) as HealthReport;
        if (alive) {
          setReport(next);
          setStale(false);
        }
      } catch (e) {
        // Keep the last answer on screen and say it may be old, rather than blanking the page.
        console.warn("[spotter] status refresh failed:", e instanceof Error ? e.message : e);
        if (alive) setStale(true);
      }
    };
    // Coming back to a tab that sat hidden: refresh straight away instead of showing an old answer as current.
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!report) {
    return (
      <p className="status-head" data-status="down" role="status">
        <span className="status-dot" aria-hidden="true" />
        The health check itself didn&apos;t answer. Try again in a minute.
      </p>
    );
  }
  const at = Date.parse(report.checkedAt);
  return (
    <div className="status">
      <p className="status-head" data-status={report.status} role="status">
        <span className="status-dot" aria-hidden="true" />
        {HEADLINE[report.status]}
      </p>
      <ul className="status-list">
        {report.checks.map((c) => (
          <li key={c.id} className="status-row" data-status={c.status}>
            <span className="status-dot" aria-hidden="true" />
            <div className="status-text">
              <p className="status-name">
                {c.name} <span className="status-word">{WORD[c.status]}</span>
              </p>
              <p className="status-sum">
                {c.summary}
                {c.lastLabel ? ` ${c.lastLabel}: ${c.lastSuccessAt ? timeAgo(c.lastSuccessAt, at) : "none on record yet"}.` : ""}
                {c.id === "channel3" && c.watchCheckedAt ? ` Shared price watch checked ${timeAgo(c.watchCheckedAt, at)}.` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="status-fine">
        Checked {new Date(report.checkedAt).toISOString().slice(11, 16)} UTC{stale ? ", and the last refresh didn't answer, so this may be old" : ""}. It refreshes every
        minute. The same answer as JSON: <a href="/api/health">/api/health</a>.
      </p>
    </div>
  );
}
