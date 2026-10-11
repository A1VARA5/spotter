"use client";
// "Ask Spotter" for the simple view: one question, one plain answer, in big type. AG Studio's chat panel
// only exists in edit mode, so this drives AG's own agent harness (createAiHarness, built in Studio.tsx)
// without the panel: a new thread per question, read back from the session's messages. Same Claude
// proxy and daily caps as the spotter's assistant. Answers are rendered as plain text, never as HTML.
import { useEffect, useRef, useState } from "react";
import type { AgAiChatSession, AgAiHarness } from "ag-studio";
import { GRAN_ID } from "@/watchtower/agents";

type Phase = { kind: "idle" } | { kind: "asking"; question: string } | { kind: "answered"; question: string; answer: string } | { kind: "failed"; question: string; why: string };

const MAX_QUESTION = 300;

/** The last thing the agent said in this thread, as plain text. */
function lastAnswer(s: AgAiChatSession): string {
  const msg = [...s.messages].reverse().find((m) => m.role === "assistant" && m.parts.some((p) => p.type === "text" && p.text.trim()));
  return msg ? msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim() : "";
}

/** Markdown the model may still use, taken out so the answer reads as plain sentences. */
const plain = (t: string) => t.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "");

export function GranAsk({ harness, spotter, onBusy }: { harness: () => AgAiHarness | null; spotter: string; onBusy: (busy: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [text, setText] = useState("");
  const session = useRef<AgAiChatSession | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const starters = ["Did Spotter stop anything for me?", `What is waiting for ${spotter}?`, "Someone is asking me for money. What do I do?"];

  useEffect(() => () => session.current?.close(), []);

  const ask = async (raw: string) => {
    const question = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
    if (!question || phase.kind === "asking") return;
    const h = harness();
    if (!h) {
      setPhase({ kind: "failed", question, why: "The board is still loading. Try again in a moment." });
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
          why: capped ? `Spotter has answered all it can for today. Try again tomorrow, or ring ${spotter}.` : `Spotter couldn't answer just now. Try again in a minute, or ring ${spotter}.`,
        });
      } else {
        setPhase({ kind: "answered", question, answer });
        setText("");
      }
    } catch (e) {
      console.warn("[watchtower] simple view question wasn't sent:", e);
      setPhase({ kind: "failed", question, why: `Spotter couldn't answer just now. Try again in a minute, or ring ${spotter}.` });
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
        Ask Spotter
      </h2>
      <p className="gran-ask-lede">Ask in your own words. Spotter answers from your own payments.</p>
      <ul className="gran-starters" aria-label="Questions you can ask">
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
          Your question
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
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
      <div className="gran-answer" role="status" aria-live="polite">
        {phase.kind === "asking" && <p className="gran-thinking">Spotter is looking at your payments…</p>}
        {(phase.kind === "answered" || phase.kind === "failed") && (
          <div ref={answerRef} tabIndex={-1} className="gran-answer-box" data-failed={phase.kind === "failed" || undefined}>
            <p className="gran-asked">You asked: {phase.question}</p>
            {(phase.kind === "answered" ? phase.answer : phase.why).split(/\n{2,}/).map((para, i) => (
              <p key={i} className="gran-answer-text">
                {para}
              </p>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
