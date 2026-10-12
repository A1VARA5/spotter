"use client";
// The card beside the newest answer on the Answers page: the question, what it adds up to, who built it and
// its receipt (from AG Studio's own telemetry, src/watchtower/receipt.ts), and questions to ask next. Studio
// keeps it in step through an AnswerFeed; the answer's title is the family's own question, shown as text.
import { useEffect, useSyncExternalStore } from "react";
import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { answerReceipt, builtBy, followUps, receiptSteps, type TopRow } from "@/watchtower/answers";
import { boardWords } from "@/watchtower/receipt";
import { useBook } from "./ReceiptBar";
import { useScrollBox, type WatchContext } from "./widgets";
import { useRec } from "@/ui/rec";

export type AnswerSummaryDef = { type: "answer-summary"; dataMapping: Record<string, never>; format?: AgWidgetDataFormat<unknown> };

export type Starter = { label: string; prompt: string };
/** What Studio knows about the newest answer, for the card. */
/** line: the one line answer (src/watchtower/answers.ts cardLine), on every finished answer. */
/** top: the biggest rows behind the answer (a chart's bars, or the Fair price tile's items); type: the answer tile's type. */
export type AnswerSnap = { title: string; empty: boolean; running: boolean; total?: string; line?: string; top?: readonly TopRow[]; type?: string; starters: Starter[]; canAsk: boolean; asking: boolean };
export type AnswerFeed = { get(): AnswerSnap; subscribe(fn: () => void): () => void; ask(s: Starter): void };

const NONE: AnswerSnap = { title: "", empty: true, running: false, starters: [], canAsk: false, asking: false };
const noFeed = () => () => {};
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function createAnswerFeed(ask: (s: Starter) => void): AnswerFeed & { set(next: AnswerSnap): void } {
  let snap = NONE;
  const subs = new Set<() => void>();
  return {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    ask,
    set(next) {
      const same = (Object.keys(next) as Array<keyof AnswerSnap>).every((k) => next[k] === snap[k]);
      if (same) return;
      snap = next;
      for (const fn of subs) fn();
    },
  };
}

/** The first sentence leads; a second one (the fair price headline's too cheap part) follows smaller. */
function AnswerLine({ text }: { text: string }) {
  const rec = useRec();
  const [first, ...rest] = rec.text(text).split(/(?<=\.) /);
  return (
    <p className="wt-ans-line">
      {first}
      {rest.length > 0 && <span className="wt-ans-line-more"> {rest.join(" ")}</span>}
    </p>
  );
}

function RowList({ rows }: { rows: readonly TopRow[] }) {
  const rec = useRec();
  return (
    <ul className="wt-ans-rowlist">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="wt-ans-row-label">{rec.text(r.label)}</span>
          <span className="wt-ans-row-value">{rec.text(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AnswerSummaryWidget(p: AgWidgetParams<AnswerSummaryDef>) {
  const ctx = p.context as WatchContext | undefined;
  const feed = ctx?.answers;
  const a = useSyncExternalStore(feed?.subscribe ?? noFeed, feed?.get ?? (() => NONE), () => NONE);
  const { entries } = useBook(ctx?.receipts);
  const scroll = useScrollBox<HTMLElement>();
  useEffect(() => {
    p.widgetApi.setDisplayState("displayed");
  }, [p.widgetApi]);

  const receipt = a.empty ? null : answerReceipt(entries.map((e) => e.receipt));
  const calls = receipt?.tools.reduce((t, l) => t + l.calls, 0) ?? 0;
  const next = followUps(a.starters, a.title);
  // A chart with one bar already says it in the line above ("All of it: BlockWorld"), so its list starts at two.
  const fair = a.type === "fair-price";
  const rows = !a.empty && a.top && a.top.length >= (fair ? 1 : 2) ? a.top : [];
  // A fair price answer's rows: what its first sentence adds up, then the too cheap ones under their own line.
  const lead = rows.filter((r) => r.group !== "too-cheap");
  const cheap = rows.filter((r) => r.group === "too-cheap");
  const steps = receipt ? receiptSteps(receipt) : [];
  return (
    <section className="wt-ans" aria-labelledby="wt-ans-q" {...scroll}>
      <p className="wt-ans-kicker">{a.empty ? (a.running ? "Building your answer" : "This answer didn't finish") : "Latest answer"}</p>
      <h2 id="wt-ans-q" className="wt-ans-q">
        {a.title || "Your question"}
      </h2>
      {!a.empty && (a.total || a.line) && (
        <div className="wt-ans-answer">
          {a.total && (
            <p className="wt-ans-total">
              <span className="wt-ans-sum">{a.total}</span> in total
            </p>
          )}
          {a.line && <AnswerLine text={a.line} />}
        </div>
      )}
      {lead.length > 0 && (
        <div className="wt-ans-rows">
          <h3 className="wt-ans-next-h">{fair ? "Behind the headline" : `The biggest ${lead.length === 1 ? "row" : `${lead.length} rows`} in the chart`}</h3>
          <RowList rows={lead} />
        </div>
      )}
      {cheap.length > 0 && (
        <div className="wt-ans-rows">
          <h3 className="wt-ans-next-h">Too cheap to be real</h3>
          <RowList rows={cheap} />
        </div>
      )}
      {receipt && (
        <dl className="wt-ans-facts">
          <div>
            <dt>Built by</dt>
            <dd>{builtBy(receipt).join(", ")}</dd>
          </div>
          <div>
            <dt>Receipt</dt>
            <dd>
              {calls} {calls === 1 ? "call" : "calls"} in {secs(receipt.ms)}
              <span className="wt-ans-money" data-flagged={receipt.flagged || undefined}>
                {receipt.flagged ? `Money actions: ${receipt.moneyActions} unchecked` : "Money actions: 0"}
              </span>
              {boardWords(receipt).replace(/\.$/, "")}
            </dd>
          </div>
          {steps.length > 0 && (
            <div className="wt-ans-steps">
              <dt>What Spotter did</dt>
              <dd>
                <ul className="wt-ans-steplist">
                  {steps.map((s) => (
                    <li key={s.what}>
                      {s.what}
                      {s.times > 1 && <span className="wt-ans-times">, {s.times} times</span>}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      )}
      {next.length > 0 && (
        <div className="wt-ans-next">
          <h3 className="wt-ans-next-h">Ask next</h3>
          {a.canAsk ? (
            <ul className="wt-ans-list">
              {next.map((s) => (
                <li key={s.label}>
                  <button type="button" className="wt-ans-btn" disabled={a.asking || a.running} onClick={() => feed?.ask(s)}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="wt-ans-hint">Open Watchtower on a laptop to ask:</p>
              <ul className="wt-ans-plain">
                {next.map((s) => (
                  <li key={s.label}>{s.label}</li>
                ))}
              </ul>
            </>
          )}
          {a.canAsk && (a.asking || a.running) && <p className="wt-ans-hint">Spotter is answering. Ask the next one when it&apos;s done.</p>}
        </div>
      )}
    </section>
  );
}
