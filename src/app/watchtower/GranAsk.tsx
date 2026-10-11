"use client";
// "Ask Spotter" for the simple view: one question, one plain answer, in big type. AG Studio's chat panel
// only exists in edit mode, so this drives AG's own agent harness (createAiHarness, built in Studio.tsx)
// without the panel: a new thread per question, read back from the session's messages. Same Claude
// proxy and daily caps as the spotter's assistant. Answers are rendered as plain text, never as HTML.
import { useEffect, useRef, useState } from "react";
import type { AgAiChatSession, AgAiHarness } from "ag-studio";
import { GRAN_ID } from "@/watchtower/agents";
import type { Receipt } from "@/watchtower/receipt";
import { gt, type GranLang } from "@/watchtower/granLang";
import { useBook, type ReceiptBook } from "./ReceiptBar";

type Phase = { kind: "idle" } | { kind: "asking"; question: string } | { kind: "answered"; question: string; answer: string; threadId: string } | { kind: "failed"; question: string; why: string };

const MAX_QUESTION = 300;

/** The last thing the agent said in this thread, as plain text. */
function lastAnswer(s: AgAiChatSession): string {
  const msg = [...s.messages].reverse().find((m) => m.role === "assistant" && m.parts.some((p) => p.type === "text" && p.text.trim()));
  return msg ? msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim() : "";
}

/** Markdown the model may still use, taken out so the answer reads as plain sentences. */
const plain = (t: string) => t.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "");

/** Under the answer: what Spotter did to get it, from AG Studio's own record of the run, in Gran's words. */
function GranReceipt({ r, spotter, lang }: { r: Receipt; spotter: string; lang: GranLang }) {
  const looks = r.tools.find((t) => t.name === "my_month")?.calls ?? 0;
  const other = r.tools.filter((t) => t.name !== "my_month").reduce((n, t) => n + t.calls, 0);
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

  useEffect(() => () => session.current?.close(), []);

  const ask = async (raw: string) => {
    const question = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
    if (!question || phase.kind === "asking") return;
    const h = harness();
    if (!h) {
      setPhase({ kind: "failed", question, why: gt(lang, "stillLoading") });
      return;
    }
    setPhase({ kind: "asking", question });
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
      const answer = plain(lastAnswer(s));
      const error = s.messages.flatMap((m) => m.parts).find((p): p is { type: "error"; message: string } => p.type === "error");
      // An error part means the run stopped short: any text before it is half an answer, so don't show it.
      if (!inTime || s.status === "error" || error || !answer) {
        console.warn("[watchtower] simple view answer failed:", error?.message ?? s.status);
        // The daily cap is the one failure where "try again in a minute" is wrong.
        const capped = !!error && /today|tomorrow/i.test(error.message);
        setPhase({
          kind: "failed",
          question,
          why: gt(lang, capped ? "capped" : "askFailed", { spotter }),
        });
      } else {
        setPhase({ kind: "answered", question, answer, threadId: s.threadId });
        setText("");
      }
    } catch (e) {
      console.warn("[watchtower] simple view question wasn't sent:", e);
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
          <div ref={answerRef} tabIndex={-1} className="gran-answer-box" data-failed={phase.kind === "failed" || undefined}>
            <p className="gran-asked">{gt(lang, "youAsked", { q: phase.question })}</p>
            {(phase.kind === "answered" ? phase.answer : phase.why).split(/\n{2,}/).map((para, i) => (
              <p key={i} className="gran-answer-text">
                {para}
              </p>
            ))}
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
