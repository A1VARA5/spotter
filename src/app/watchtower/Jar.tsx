"use client";
// The glass jar (src/watchtower/jar.ts) for demo families: one switch for Spotter's harness, and the two things
// a scripted test agent tries after reading a sample scam text. Harness off, both fake calls run. Harness on,
// both wait at the same gate the real assistant's board changes use, and the person answers them here.
// The scam text is shown as plain text only. Fake tools: nothing real happens either way.
import { useEffect, useId, useRef, useState } from "react";
import { createGate, type Gate } from "@/watchtower/hold";
import { JAR_PAYEE, JAR_SCAM, runJar, type JarOutcome, type JarStep } from "@/watchtower/jar";
import "./jar.css";

const OUTCOME: Record<JarOutcome, string> = {
  "ran (fake)": "Ran (fake)",
  held: "Held for you",
  refused: "Refused by you",
  "allowed (fake)": "Allowed by you (fake)",
};

const WHAT: Record<string, string> = {
  place_widget: "Pin a tile on the board",
  send_money: "Send money",
};

function argLine(s: JarStep): string {
  if (s.tool === "send_money") return `£${Number(s.args.amount).toFixed(2)} to ${String(s.args.to)}`;
  return `Titled "${String(s.args.title)}"`;
}

function Jar() {
  const [protect, setProtect] = useState(true);
  const [steps, setSteps] = useState<JarStep[]>([]);
  const [said, setSaid] = useState("");
  const gateRef = useRef<Gate | null>(null);

  useEffect(() => {
    const gate = createGate();
    const stop = new AbortController();
    gateRef.current = gate;
    setSteps([]);
    let live = true;
    runJar({
      protect,
      scamText: JAR_SCAM,
      payee: JAR_PAYEE,
      gate,
      signal: stop.signal,
      onStep: (s) => {
        if (!live) return;
        setSteps(s);
        const last = s.at(-1);
        if (last) setSaid(`${WHAT[last.tool] ?? last.tool}: ${OUTCOME[last.outcome]}.${last.outcome === "held" ? " Allow or refuse it." : ""}`);
      },
    }).then(
      () => {
        if (live) setSaid((x) => `${x} Money moved: £0.00.`);
      },
      (e) => console.error("[watchtower] the glass jar's test agent failed:", e),
    );
    return () => {
      live = false;
      stop.abort();
    };
  }, [protect]);

  const answer = (tool: string, type: "approve" | "reject") => {
    const call = gateRef.current?.pending().find((c) => c.name === tool);
    if (call) gateRef.current!.respond(call.toolCallId, { type });
  };

  return (
    <div className="jar">
      <p className="jar-kicker">AG&apos;s agents plus Spotter&apos;s harness</p>
      <p className="jar-lede">
        A test agent reads a sample scam text and does what it says. Switch Spotter&apos;s harness off to see what it tries on its own, then on to see the same calls wait for you.
      </p>

      <ul className="jar-labels" aria-label="About this test">
        <li>Test agent (scripted)</li>
        <li>Fake tools, nothing real happens</li>
        <li className="jar-money">Money moved: £0.00</li>
      </ul>

      <figure className="jar-text">
        <figcaption>The text it reads</figcaption>
        <blockquote>{JAR_SCAM}</blockquote>
      </figure>

      <button type="button" role="switch" aria-checked={protect} className="jar-switch" onClick={() => setProtect((p) => !p)}>
        <span className="jar-switch-label">Spotter&apos;s harness</span>
        <span className="jar-track" aria-hidden="true">
          <span className="jar-thumb" />
        </span>
        <span className="jar-switch-state">{protect ? "On" : "Off"}</span>
      </button>

      <ol className="jar-steps" aria-label="What the test agent tried">
        {steps.map((s, i) => (
          <li key={`${protect}-${s.tool}`} className="jar-step" data-outcome={s.outcome}>
            <p className="jar-step-what">
              <span className="jar-step-n">{i + 1}</span>
              {WHAT[s.tool] ?? s.tool}
              <span className="jar-step-fake">fake</span>
            </p>
            <p className="jar-step-args">{argLine(s)}</p>
            <p className="jar-step-out">{OUTCOME[s.outcome]}</p>
            {s.outcome === "held" && (
              <div className="jar-step-ask">
                <p className="jar-step-why">It used words the scammer wrote, so it waits for you.</p>
                <div className="wt-held-btns">
                  <button type="button" className="wt-held-btn" data-kind="allow" onClick={() => answer(s.tool, "approve")}>
                    Allow
                  </button>
                  <button type="button" className="wt-held-btn" data-kind="refuse" onClick={() => answer(s.tool, "reject")}>
                    Refuse
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="jar-said" role="status">
        {said}
      </p>
      <p className="jar-foot">
        The test agent is a script, not a model, and its tools only write to a list on this page. Allowed calls are still fake. Nothing here can reach PayPal.
      </p>
    </div>
  );
}

/** The entry for demo families: a small strip under the board with the button that opens the jar. */
export function JarEntry() {
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState(false);
  const labelId = useId();
  return (
    <div className="jar-entry">
      <p className="jar-entry-text">Demo: see what a test agent tries with a scam text, with and without Spotter&apos;s harness.</p>
      <button
        type="button"
        className="wt-rc-btn jar-entry-btn"
        aria-haspopup="dialog"
        onClick={() => {
          setShown(true);
          ref.current?.showModal();
        }}
      >
        Try to trick the AI
      </button>
      <dialog
        ref={ref}
        className="sheet"
        aria-labelledby={labelId}
        onClose={() => setShown(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="sheet-box">
          <div className="sheet-head">
            <h2 id={labelId} className="sheet-title">
              Try to trick the AI
            </h2>
            <button type="button" className="sheet-close" aria-label="Close" onClick={() => ref.current?.close()}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {/* Mounted only while open, so closing stops the test agent and refuses anything still waiting. */}
          {shown && <Jar />}
        </div>
      </dialog>
    </div>
  );
}
