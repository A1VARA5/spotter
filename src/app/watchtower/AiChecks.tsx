"use client";
// "Spotter's own checks": the assistant's recent runs with their receipts, newest first, so the family can
// see at a glance that no run touched money and which runs changed the board. Kept runs come from the
// server (this family's last 20), this visit's runs arrive live from the harness telemetry.
import { useEffect } from "react";
import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { helperName, type Receipt } from "@/watchtower/receipt";
import { useBook } from "./ReceiptBar";
import { useScrollBox, type WatchContext } from "./widgets";

export type AiChecksDef = { type: "ai-checks"; dataMapping: Record<string, never>; format?: AgWidgetDataFormat<unknown> };

const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" });
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function Row({ r }: { r: Receipt }) {
  const calls = r.tools.reduce((t, l) => t + l.calls, 0);
  const who = r.agentId === "gran" ? "Simple view" : "Your assistant";
  return (
    <li className="wt-checks-row" data-flagged={r.flagged || undefined}>
      <p className="wt-checks-head">
        <span className="wt-checks-dot" aria-hidden="true" />
        <span className="wt-checks-when">{when.format(r.startedAt)}</span>
        <span className="wt-checks-who">{who}</span>
      </p>
      <p className="wt-checks-facts">
        {calls} {calls === 1 ? "call" : "calls"} in {secs(r.ms)}. <span className="wt-checks-money">{r.flagged ? `Money actions: ${r.moneyActions} unchecked, flagged.` : "Money actions: 0."}</span> Board changes: {r.boardChanges}.
        {r.status !== "ok" && (r.status === "error" ? " Ended with a problem." : " Stopped.")}
      </p>
      {r.helpers.length > 0 && <p className="wt-checks-help">Helpers: {r.helpers.map(helperName).join(", ")}.</p>}
    </li>
  );
}

export function AiChecksWidget(p: AgWidgetParams<AiChecksDef>) {
  const { entries } = useBook((p.context as WatchContext | undefined)?.receipts);
  const scroll = useScrollBox<HTMLDivElement>();
  useEffect(() => {
    p.widgetApi.setDisplayState("displayed");
  }, [p.widgetApi]);
  const flagged = entries.filter((e) => e.receipt.flagged).length;
  return (
    <div className="wt-checks" {...scroll}>
      <p className="wt-checks-label">Spotter&apos;s own checks on its assistant</p>
      {entries.length ? (
        <>
          <p className="wt-checks-sum" data-flagged={flagged > 0 || undefined}>
            {flagged ? `${flagged} of the last ${entries.length} runs used a tool outside Spotter's list.` : `The last ${entries.length === 1 ? "run" : `${entries.length} runs`} touched no money.`}
          </p>
          <ul className="wt-checks-list" aria-label="The assistant's recent runs">
            {entries.map((e) => (
              <Row key={e.receipt.runId} r={e.receipt} />
            ))}
          </ul>
          <p className="wt-checks-note">From AG Studio&apos;s own record of each run, not from what the assistant said.</p>
        </>
      ) : (
        <p className="wt-checks-sum">No runs yet. Ask the assistant something and its receipt shows here.</p>
      )}
    </div>
  );
}
