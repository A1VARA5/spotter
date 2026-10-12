"use client";
// How Spotter's own tool calls show in AG Studio's chat (the aiToolDisplay property): the row says what
// the call did in plain words with a count in the pill, and opening it shows a small card built only from
// counts and Spotter's fixed labels (src/watchtower/toolCards.ts). Nothing a scammer wrote reaches it,
// except one thing on purpose: a board change held for the spotter (src/watchtower/hold.ts) quotes the
// scammer's words it carried, as plain text, so the spotter can see why it waits before choosing.
// delegate_to and Studio's own tools keep the display Studio declares for them.
import { useState, useSyncExternalStore } from "react";
import type { AgAiToolDetailParams } from "ag-studio";
import type { AgAiToolDisplay } from "ag-studio-react";
import { CARD_TOOLS, describeCall, wantsTo, type CallStatus } from "@/watchtower/toolCards";
import { findHeld, type Gate, type HeldCall } from "@/watchtower/hold";

type Result = Parameters<typeof describeCall>[2]["result"];

const usePending = (gate: Gate) => useSyncExternalStore(gate.subscribe, gate.pending, NO_PENDING);
const EMPTY: HeldCall[] = [];
function NO_PENDING() {
  return EMPTY;
}

/** The scammer's words and the two buttons. `said` stays after answering, until the call moves on. */
function HeldAsk({ gate, call }: { gate: Gate; call: HeldCall }) {
  const [said, setSaid] = useState<string | null>(null);
  const answer = (type: "approve" | "reject") => {
    const ok = gate.respond(call.toolCallId, { type });
    setSaid(ok ? (type === "approve" ? "Allowed by you" : "Refused by you") : "This change isn't waiting any more.");
  };
  return (
    <div className="wt-held-ask">
      <p className="wt-held-why">
        It used words a scammer wrote: <q className="wt-held-quote">{call.quote}</q>
      </p>
      {said ? (
        <p className="wt-held-said" role="status">
          {said}
        </p>
      ) : (
        <div className="wt-held-btns">
          <button type="button" className="wt-held-btn" data-kind="allow" onClick={() => answer("approve")}>
            Allow
          </button>
          <button type="button" className="wt-held-btn" data-kind="refuse" onClick={() => answer("reject")}>
            Refuse
          </button>
        </div>
      )}
    </div>
  );
}

function ToolCard({ gate, ...p }: AgAiToolDetailParams & { gate: Gate }) {
  const card = describeCall(p.name, p.args as Record<string, unknown>, { status: p.status as CallStatus, result: p.result as Result });
  const board = card.access === "board";
  const pending = usePending(gate);
  const held = p.status === "awaiting_approval" ? findHeld(pending, p.name, p.args) : undefined;
  return (
    <div className="wt-card">
      {p.status === "awaiting_approval" && <p className="wt-held-title">{card.text}</p>}
      <ul className="wt-card-lines">
        {card.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {held && <HeldAsk key={held.toolCallId} gate={gate} call={held} />}
      <p className="wt-card-foot">
        <span className="wt-card-mark" data-access={card.access}>
          {board ? "Changes the board only" : card.access === "unknown" ? "Not on Spotter's list" : "Read only"}
        </span>
        <span>{card.access === "unknown" ? "Spotter can't vouch for this tool." : "Can't move money."}</span>
        {card.took !== undefined && <span className="wt-card-time">Took {card.took < 1000 ? `${card.took} ms` : `${(card.took / 1000).toFixed(1)} s`}.</span>}
      </p>
    </div>
  );
}

/** One entry per tool Spotter defines, keyed by tool name as AG asks (so replayed chats render the same). */
export function spotterToolDisplay(gate: Gate): Record<string, AgAiToolDisplay> {
  const out: Record<string, AgAiToolDisplay> = {};
  for (const name of CARD_TOOLS) {
    out[name] = {
      label: (p) => {
        const c = describeCall(name, p.args as Record<string, unknown>, { status: p.status, result: p.result as Result });
        return c.pill ? { text: c.text, pill: c.pill } : { text: c.text };
      },
      detail: (p: AgAiToolDetailParams) => <ToolCard {...p} gate={gate} />,
    };
  }
  return out;
}

/**
 * Every board change waiting for the spotter, above the board. AG's chat keeps a call's card folded until it is
 * opened, and Studio's own tools (add_widget, configure_widget) have no card of ours, so this is where any held
 * call can always be answered. Hidden when nothing waits.
 */
export function HeldBar({ gate }: { gate: Gate }) {
  const pending = usePending(gate);
  return (
    <>
      <span className="wt-sr" aria-live="polite">
        {pending.length ? `${pending.length === 1 ? "A change by the assistant is" : `${pending.length} changes by the assistant are`} held for you.` : ""}
      </span>
      {pending.length > 0 && (
        <section className="wt-held" aria-label="Held for you">
          {pending.map((c) => (
            <div key={c.toolCallId} className="wt-held-row">
              <p className="wt-held-title">
                Held for you <span className="wt-held-what">The assistant wants to {wantsTo(c.name)}.</span>
              </p>
              <HeldAsk gate={gate} call={c} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}
