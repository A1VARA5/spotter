"use client";
// How Spotter's own tool calls show in AG Studio's chat (the aiToolDisplay property): the row says what
// the call did in plain words with a count in the pill, and opening it shows a small card built only from
// counts and Spotter's fixed labels (src/watchtower/toolCards.ts). Nothing a scammer wrote reaches it.
// delegate_to and Studio's own tools keep the display Studio declares for them.
import type { AgAiToolDetailParams } from "ag-studio";
import type { AgAiToolDisplay } from "ag-studio-react";
import { CARD_TOOLS, describeCall, type CallStatus } from "@/watchtower/toolCards";

type Result = Parameters<typeof describeCall>[2]["result"];

function ToolCard(p: AgAiToolDetailParams) {
  const card = describeCall(p.name, p.args as Record<string, unknown>, { status: p.status as CallStatus, result: p.result as Result });
  const board = card.access === "board";
  return (
    <div className="wt-card">
      <ul className="wt-card-lines">
        {card.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
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
export function spotterToolDisplay(): Record<string, AgAiToolDisplay> {
  const out: Record<string, AgAiToolDisplay> = {};
  for (const name of CARD_TOOLS) {
    out[name] = {
      label: (p) => {
        const c = describeCall(name, p.args as Record<string, unknown>, { status: p.status, result: p.result as Result });
        return c.pill ? { text: c.text, pill: c.pill } : { text: c.text };
      },
      detail: ToolCard,
    };
  }
  return out;
}
