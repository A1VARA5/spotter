"use client";
// "Ask Spotter" for the simple view: one question, one answer, in big type. AG Studio's chat panel only
// exists in edit mode, so this drives AG's own agent harness (createAiHarness, built in Studio.tsx) without
// the panel: a new thread per question. Same Claude proxy and daily caps as the spotter's assistant.
// The answer is what Spotter pointed at on the board (point_at), told in Spotter's own fixed words
// (src/watchtower/point.ts). Nothing the model writes is ever read or shown here, so a scammer's words in a
// payee name can never come back as Spotter's sentence. Captions are plain text, never HTML.
import { useEffect, useRef, useState } from "react";
import type { AgAiChatSession, AgAiHarness } from "ag-studio";
import { GRAN_ID } from "@/watchtower/agents";
import type { Receipt } from "@/watchtower/receipt";
import { gt, type GranLang } from "@/watchtower/granLang";
import { answerOf, granPointer, nothingMatched, toolErrored, type Pointable } from "@/watchtower/point";
import { useBook, type ReceiptBook } from "./ReceiptBar";

type Phase =
  | { kind: "idle" }
  | { kind: "asking"; question: string }
  | { kind: "answered"; question: string; items: Pointable[]; mood: "warn" | "calm"; threadId: string }
  | { kind: "failed"; question: string; why: string };

const MAX_QUESTION = 300;

/** Under the answer: what Spotter did to get it, from AG Studio's own record of the run, in Gran's words. */
function GranReceipt({ r, spotter, lang }: { r: Receipt; spotter: string; lang: GranLang }) {
  const looks = r.tools.find((t) => t.name === "my_month")?.calls ?? 0;
  // Pointing is how it answers, not another thing it did.
  const other = r.tools.filter((t) => t.name !== "my_month" && t.name !== "point_at").reduce((n, t) => n + t.calls, 0);
  const s = Math.max(1, Math.round(r.ms / 1000));
  const looked = looks === 0 ? gt(lang, "lookedNone") : looks === 1 ? gt(lang, "lookedOnce") : looks === 2 ? gt(lang, "lookedTwice") : gt(lang, "lookedTimes", { n: looks });
  return (
    <div className="gran-receipt" data-flagged={r.flagged || undefined}>
      <p className="gran-receipt-h">{gt(lang, "receiptTitle")}</p>
      <p>
        {looked}
        {other === 1 ? gt(lang, "otherThing") : other > 1 ? gt(lang, "otherThings", { n: other }) : ""}
        {s === 1 ? gt(lang, "tookOne") : gt(lang, "took", { s })}
      </p>
      <p className="gran-receipt-money">{r.flagged ? gt(lang, "receiptFlagged", { spotter }) : gt(lang, "receiptMoney")}</p>
    </div>
  );
}

export function GranAsk({ harness, spotter, onBusy, book, lang = "en" }: { harness: () => AgAiHarness | null; spotter: string; onBusy: (busy: boolean) => void; book?: ReceiptBook; lang?: GranLang }) {
  const { entries } = useBook(book);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [text, setText] = useState("");
  const session = useRef<AgAiChatSession | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const starters = [gt(lang, "starterStopped"), gt(lang, "starterWaiting", { spotter }), gt(lang, "starterAsking")];

  useEffect(
    () => () => {
      session.current?.close();
      granPointer.point(null);
    },
    [],
  );

  const ask = async (raw: string) => {
    const question = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
    if (!question || phase.kind === "asking") return;
    const h = harness();
    if (!h) {
      setPhase({ kind: "failed", question, why: gt(lang, "stillLoading") });
      return;
    }
    setPhase({ kind: "asking", question });
    // The last answer's glow clears as the next question goes.
    granPointer.point(null);
    onBusy(true);
    session.current?.close();
    try {
      const s = await h.createThread({ agentId: GRAN_ID, title: question.slice(0, 60) });
      session.current = s;
      // Settles when the run ends (or errors), or after 90 s so the box never spins forever.
      let stop = () => {};
      const done = new Promise<boolean>((resolve) => {
        let started = false;
        const finish = (inTime: boolean) => {
          clearTimeout(timer);
          s.removeEventListener("changed", check);
          resolve(inTime);
        };
        const check = () => {
          if (s.status === "running") started = true;
          if (s.status === "error" || (started && s.status !== "running")) finish(true);
        };
        const timer = setTimeout(() => {
          console.warn("[watchtower] simple view answer took over 90 s; giving up");
          s.cancel();
          finish(false);
        }, 90_000);
        s.addEventListener("changed", check);
        stop = () => finish(false);
      });
      try {
        s.sendMessage(question);
      } catch (e) {
        stop(); // no timer or listener left behind to cancel later
        throw e;
      }
      const inTime = await done;
      const error = s.messages.flatMap((m) => m.parts).find((p): p is { type: "error"; message: string } => p.type === "error");
      // An error part means the run stopped short: anything it lit may be half an answer, so it goes dark.
      if (!inTime || s.status === "error" || error) {
        console.warn("[watchtower] simple view answer failed:", error?.message ?? s.status);
        granPointer.point(null);
        // The daily cap is the one failure where "try again in a minute" is wrong.
        const capped = !!error && /today|tomorrow/i.test(error.message);
        setPhase({
          kind: "failed",
          question,
          why: gt(lang, capped ? "capped" : "askFailed", { spotter }),
        });
      } else {
        // What this run pointed at. Nothing lit is "nothing matched", unless a tool broke on the way.
        const a = answerOf(granPointer.current(), s.threadId, toolErrored(s.messages));
        if (a.kind === "failed" || !a.items.length) granPointer.point(null);
        if (a.kind === "failed") {
          console.warn("[watchtower] simple view answer failed: a tool call errored and nothing was lit");
          setPhase({ kind: "failed", question, why: gt(lang, "askFailed", { spotter }) });
        } else {
          if (!a.pointed) console.warn("[watchtower] simple view run ended without calling point_at:", s.threadId);
          setPhase({ kind: "answered", question, items: a.items, mood: a.mood, threadId: s.threadId });
          setText("");
        }
      }
    } catch (e) {
      console.warn("[watchtower] simple view question wasn't sent:", e);
      granPointer.point(null);
      setPhase({ kind: "failed", question, why: gt(lang, "askFailed", { spotter }) });
    } finally {
      onBusy(false);
    }
  };

  // After an answer, move focus to it so a keyboard or screen reader user lands on what changed.
  useEffect(() => {
    if (phase.kind === "answered" || phase.kind === "failed") answerRef.current?.focus();
  }, [phase.kind]);

  const busy = phase.kind === "asking";
  return (
    <aside className="gran-ask" aria-labelledby="gran-ask-h">
      <h2 id="gran-ask-h" className="gran-h">
        {gt(lang, "askTitle")}
      </h2>
      <p className="gran-ask-lede">{gt(lang, "askLede")}</p>
      <ul className="gran-starters" aria-label={gt(lang, "startersLabel")}>
        {starters.map((q) => (
          <li key={q}>
            <button type="button" className="gran-starter" onClick={() => void ask(q)} disabled={busy}>
              {q}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="gran-ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <label htmlFor="gran-question" className="gran-label">
          {gt(lang, "questionLabel")}
        </label>
        <textarea
          id="gran-question"
          name="question"
          rows={2}
          maxLength={MAX_QUESTION}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void ask(text);
            }
          }}
        />
        <button type="submit" className="gran-ask-btn" disabled={busy} aria-disabled={busy || !text.trim() ? true : undefined}>
          {busy ? gt(lang, "asking") : gt(lang, "ask")}
        </button>
      </form>
      <div className="gran-answer" role="status" aria-live="polite">
        {phase.kind === "asking" && <p className="gran-thinking">{gt(lang, "thinking")}</p>}
        {(phase.kind === "answered" || phase.kind === "failed") && (
          <div ref={answerRef} tabIndex={-1} className="gran-answer-box" data-failed={phase.kind === "failed" || undefined} data-mood={phase.kind === "answered" ? phase.mood : undefined}>
            <p className="gran-asked">{gt(lang, "youAsked", { q: phase.question })}</p>
            {phase.kind === "failed" ? (
              <p className="gran-answer-text">{phase.why}</p>
            ) : phase.items.length ? (
              <>
                <p className="gran-answer-h">{gt(lang, "pointTitle")}</p>
                <ul className="gran-pointed">
                  {phase.items.map((it) => (
                    <li key={it.handle} className="gran-answer-text" data-kind={it.kind}>
                      {it.caption}
                      {it.sample && <> <span className="gran-sample">{gt(lang, "sample")}</span></>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="gran-answer-text">{nothingMatched(lang, spotter)}</p>
            )}
            {phase.kind === "answered" && (() => {
              const r = entries.find((e) => e.receipt.threadId === phase.threadId)?.receipt;
              // No receipt for a finished answer is itself worth saying: it's the proof that's missing.
              return r ? <GranReceipt r={r} spotter={spotter} lang={lang} /> : <p className="gran-receipt gran-receipt-missing">{gt(lang, "receiptMissing", { spotter })}</p>;
            })()}
          </div>
        )}
      </div>
    </aside>
  );
}
