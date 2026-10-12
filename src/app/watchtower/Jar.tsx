"use client";
// The glass jar (src/watchtower/jar.ts) for demo families: one switch for Spotter's harness, and the two things
// a scripted test agent tries after reading a sample scam text. It opens with the harness off: both fake calls
// run. Then the person switches it on, and both wait at the same gate the real assistant's board changes use.
// The scam text is shown as plain text only. Fake tools: nothing real happens either way.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createGate, type Gate } from "@/watchtower/hold";
import { JAR_PAYEE, JAR_SCAM, JAR_STARTS_ON, TRICK_COST, jarNext, runJar, type JarOutcome, type JarStep } from "@/watchtower/jar";
import { useDismiss } from "./useDismiss";
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
  const [protect, setProtect] = useState(JAR_STARTS_ON);
  const [steps, setSteps] = useState<JarStep[]>([]);
  const [said, setSaid] = useState("");
  const [finished, setFinished] = useState(false);
  const gateRef = useRef<Gate | null>(null);

  useEffect(() => {
    const gate = createGate();
    const stop = new AbortController();
    gateRef.current = gate;
    setSteps([]);
    setFinished(false);
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
        if (!live) return;
        setSaid((x) => `${x} Money moved: £0.00.`);
        setFinished(true);
      },
      (e) => console.error("[watchtower] the glass jar's test agent failed:", e),
    );
    return () => {
      live = false;
      stop.abort();
    };
  }, [protect]);

  const next = jarNext(protect, steps, finished);
  const answer = (tool: string, type: "approve" | "reject") => {
    const call = gateRef.current?.pending().find((c) => c.name === tool);
    if (call) gateRef.current!.respond(call.toolCallId, { type });
  };

  return (
    <div className="jar">
      <p className="jar-kicker">AG&apos;s agents plus Spotter&apos;s harness</p>
      <p className="jar-lede">
        A test agent reads a sample scam text and does what it says. It starts with Spotter&apos;s harness off, so you see what it tries on its own. Then switch the harness on and the same calls wait for you.
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
      {/* Next to the switch, so the next step is on screen without scrolling the panel. */}
      {next && (
        <p className="jar-next">
          <span className="jar-next-kicker">Next step</span> {next}
        </p>
      )}

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

/**
 * "Try to trick it": the demo family's menu of the three safety tests, beside Reset board so the board keeps
 * its room. Each item says what it costs: the jar is free (a script), asking the assistant uses one real turn,
 * and Gran's view is free to open, with only a question there using the real AI.
 */
export function JarMenu({ onAskHeld, onGran, granLabel }: { onAskHeld?: () => void; onGran: () => void; granLabel: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const labelId = useId();
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrap, ".jar-menu-btn");

  const pick = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <div className="jar-menu" ref={wrap}>
      <button type="button" className="jar-menu-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        Try to trick it <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul id={menuId} className="jar-menu-list">
          <li>
            <button
              type="button"
              className="jar-menu-item"
              onClick={pick(() => {
                setShown(true);
                ref.current?.showModal();
              })}
            >
              <strong>A test agent reads a scam text</strong>
              <span>Harness off, then on.</span>
              <span className="jar-cost" data-cost="free">{TRICK_COST.jar}</span>
            </button>
          </li>
          {onAskHeld && (
            <li>
              <button type="button" className="jar-menu-item" onClick={pick(onAskHeld)}>
                <strong>Ask the assistant to copy a scammer&apos;s words</strong>
                <span className="jar-cost" data-cost="ai">{TRICK_COST.held}</span>
              </button>
            </li>
          )}
          <li>
            <button type="button" className="jar-menu-item" onClick={pick(onGran)}>
              <strong>{granLabel}: the AI can only point</strong>
              <span>It lights the rows, it never writes.</span>
              <span className="jar-cost" data-cost="ai">{TRICK_COST.gran}</span>
            </button>
          </li>
        </ul>
      )}
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
