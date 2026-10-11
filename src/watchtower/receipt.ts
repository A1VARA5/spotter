// The AI's receipt. Watchtower's assistant reads text scammers wrote, so what it did is proven from
// AG Studio's own harness telemetry (AgAiTelemetryObserver), not from what the model says it did.
// A recorder folds one run's events (and its delegated sub-runs) into a compact receipt: which tools ran,
// how often, how long, and whether any of them is outside the list of tools that can't move money.
// It never keeps the question, the prompt, tool arguments or tool results: names, counts and times only.
import type { AgAiTelemetryEvent, AgAiTelemetryObserver, AgReportHistoryEntry } from "ag-studio";

/** What a tool can touch. None of the tools Watchtower's agents have can move money. */
export type Access = "read" | "chat" | "board";

/**
 * Every tool Watchtower's agents can call, by name. "read" looks at data, "chat" only changes the
 * conversation (its title, its plan), "board" changes the dashboard. Anything not here is unknown.
 */
export const TOOL_ACCESS: Readonly<Record<string, Access>> = Object.freeze({
  // Spotter's own (Studio.tsx)
  open_case_file: "read",
  watch_alerts: "read",
  scam_radar: "read",
  paypal_status: "read",
  real_price: "read",
  fair_prices: "read",
  my_month: "read",
  add_page: "board",
  // Studio's built in tools (api.getAiTools(), checked in the running app)
  view_schema: "read",
  view_report: "read",
  view_page: "read",
  view_widget: "read",
  execute_query: "read",
  create_expression: "board",
  update_expression: "board",
  delete_expression: "board",
  add_widget: "board",
  position_widget: "board",
  remove_widget: "board",
  configure_widget: "board",
  add_page_filter: "board",
  remove_page_filter: "board",
  add_widget_filter: "board",
  remove_widget_filter: "board",
  // The harness's own tools (DEFAULT_AI_STRINGS keys)
  view_plan: "read",
  create_plan: "chat",
  update_plan: "chat",
  clear_plan: "chat",
  rename_thread: "chat",
  delegate_to: "read",
  complete_task: "read",
});

/** Each tool in plain words, for the receipt's list of calls. */
export const TOOL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  open_case_file: "Opened a case file",
  watch_alerts: "Checked what needs attention",
  scam_radar: "Checked the scam radar",
  paypal_status: "Read PayPal's record",
  real_price: "Checked real shop prices",
  fair_prices: "Checked this month's prices",
  my_month: "Looked at this month",
  add_page: "Added a page",
  view_schema: "Read how the data is laid out",
  view_report: "Looked at the board",
  view_page: "Looked at a page",
  view_widget: "Looked at a widget",
  execute_query: "Counted up the payments",
  create_expression: "Made a calculation",
  update_expression: "Changed a calculation",
  delete_expression: "Removed a calculation",
  add_widget: "Added a widget",
  position_widget: "Moved a widget",
  remove_widget: "Removed a widget",
  configure_widget: "Set up a widget",
  add_page_filter: "Added a page filter",
  remove_page_filter: "Removed a page filter",
  add_widget_filter: "Added a widget filter",
  remove_widget_filter: "Removed a widget filter",
  view_plan: "Read the plan",
  create_plan: "Made a plan",
  update_plan: "Updated the plan",
  clear_plan: "Cleared the plan",
  rename_thread: "Named the chat",
  delegate_to: "Handed work to a helper",
  complete_task: "Reported back",
});

/** Studio's agents and ours, by id, as the receipt names them. */
export const HELPER_NAMES: Readonly<Record<string, string>> = Object.freeze({ spotter: "Spotter", gran: "Spotter", brief: "Weekly brief", lead: "Lead", data: "Data", page: "Page", planning: "Planning", widget: "Widget" });

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export const toolWords = (name: string) => (own(TOOL_WORDS, name) ? TOOL_WORDS[name]! : "A tool Spotter doesn't know");
export const helperName = (id: string) => (own(HELPER_NAMES, id) ? HELPER_NAMES[id]! : "Another helper");

export function accessOf(name: string): Access | "unknown" {
  return Object.prototype.hasOwnProperty.call(TOOL_ACCESS, name) ? TOOL_ACCESS[name]! : "unknown";
}

export type ToolLine = { name: string; calls: number; ms: number; failed: number; access: Access | "unknown" };
export type Receipt = {
  runId: string;
  threadId: string;
  agentId: string;
  startedAt: number;
  ms: number;
  status: "ok" | "error" | "cancelled";
  turns: number;
  tokens: { input: number; output: number };
  tools: ToolLine[];
  /** Agents the run handed work to (delegated sub-runs), by id. */
  helpers: string[];
  /** Tool names outside TOOL_ACCESS that the model asked for or ran. */
  unknown: string[];
  /** Calls to unknown tools: Spotter can't show they didn't move money, so they count as money actions. */
  moneyActions: number;
  /** Changes this run left in Studio's undo history. Filled in by the page, which can see the history. */
  boardChanges: number;
  /** False when the page couldn't compare the board before and after the run: the count is then unknown. */
  boardKnown: boolean;
  flagged: boolean;
};

type Run = {
  runId: string;
  threadId: string;
  agentId: string;
  startedAt: number;
  turns: number;
  tokens: { input: number; output: number };
  tools: Map<string, ToolLine>;
  /** Call ids seen per tool, so a call asked for and then run counts once. */
  seenCalls: Set<string>;
  helpers: string[];
  unknown: string[];
  unknownCalls: number;
};

export type RunStart = { runId: string; threadId: string; agentId: string; startedAt: number };
export type Recorder = AgAiTelemetryObserver & {
  /** How long one tool call took, once it finished (for the call's card in the chat). */
  callMs(toolCallId: string): number | undefined;
  /** The harness is going away: every run still in flight gets a receipt now, marked as stopped. */
  abandon(): void;
};

const MAX_TIMES = 500;

/**
 * An observer for one harness. `onStart` fires when a top level run starts (synchronously, so the page
 * can capture Studio's history and state before the first tool runs); `onFinish` gets the receipt.
 */
export function createRecorder(o: { onStart?: (run: RunStart) => void; onFinish: (receipt: Receipt) => void }): Recorder {
  const runs = new Map<string, Run>(); // top level runs in flight
  const rootOf = new Map<string, string>(); // any run id -> its top level run id
  const started = new Map<string, number>(); // tool call id -> start time
  const times = new Map<string, number>(); // tool call id -> duration

  const line = (run: Run, name: string): ToolLine => {
    let l = run.tools.get(name);
    if (!l) {
      l = { name, calls: 0, ms: 0, failed: 0, access: accessOf(name) };
      run.tools.set(name, l);
    }
    return l;
  };
  // A call is counted once, whichever of its events (asked for, started, finished) arrives. With no call
  // id each event counts on its own: that can only overcount, never hide a call.
  // A tool that doesn't run in the page (server or provided) is outside what Spotter can vouch for.
  const noteCall = (run: Run, given: string, callId: string | undefined, kind?: string) => {
    const name = kind && kind !== "client" ? "server_tool" : given;
    const key = `${name}\u0000${callId ?? Math.random()}`;
    if (run.seenCalls.has(key)) return;
    run.seenCalls.add(key);
    line(run, name).calls++;
    if (accessOf(name) === "unknown") {
      run.unknownCalls++;
      if (!run.unknown.includes(name)) run.unknown.push(name);
    }
  };

  const warned = new Set<string>();
  const finish = (run: Run, at: number, status: Receipt["status"]) => {
    runs.delete(run.runId);
    for (const [k, v] of rootOf) if (v === run.runId) rootOf.delete(k);
    o.onFinish({
      runId: run.runId,
      threadId: run.threadId,
      agentId: run.agentId,
      startedAt: run.startedAt,
      ms: Math.max(0, at - run.startedAt),
      status,
      turns: run.turns,
      tokens: run.tokens,
      tools: [...run.tools.values()],
      helpers: run.helpers,
      unknown: run.unknown,
      moneyActions: run.unknownCalls,
      boardChanges: 0,
      boardKnown: true,
      flagged: run.unknownCalls > 0,
    });
  };

  return {
    callMs: (id) => times.get(id),
    abandon() {
      for (const run of [...runs.values()]) finish(run, Date.now(), "cancelled");
    },
    onEvent(e: AgAiTelemetryEvent) {
      const t = e.trace;
      if (e.type === "run_started") {
        const parentRoot = t.parentRunId ? rootOf.get(t.parentRunId) : undefined;
        if (parentRoot) {
          rootOf.set(t.runId, parentRoot);
          const root = runs.get(parentRoot);
          if (root && !root.helpers.includes(t.agentId)) root.helpers.push(t.agentId);
          return;
        }
        if (t.parentRunId) return; // a sub-run of a run we never saw start
        rootOf.set(t.runId, t.runId);
        runs.set(t.runId, { runId: t.runId, threadId: t.threadId, agentId: t.agentId, startedAt: e.timestamp, turns: 0, tokens: { input: 0, output: 0 }, tools: new Map(), seenCalls: new Set(), helpers: [], unknown: [], unknownCalls: 0 });
        o.onStart?.({ runId: t.runId, threadId: t.threadId, agentId: t.agentId, startedAt: e.timestamp });
        return;
      }
      const rootId = rootOf.get(t.runId);
      const run = rootId ? runs.get(rootId) : undefined;
      if (!run) {
        if (!warned.has(t.runId)) {
          warned.add(t.runId);
          console.warn(`[watchtower] telemetry for a run the receipt never saw start (${e.type}); it isn't on any receipt.`);
        }
        return;
      }
      switch (e.type) {
        case "turn_finished":
          run.turns++;
          run.tokens.input += e.usage?.inputTokens ?? 0;
          run.tokens.output += e.usage?.outputTokens ?? 0;
          break;
        case "item_started":
          if (e.itemKind === "tool_call" && e.toolName) noteCall(run, e.toolName, e.toolCallId);
          break;
        case "tool_execution_started":
          noteCall(run, e.name, e.toolCallId, e.kind);
          started.set(e.toolCallId, e.timestamp);
          break;
        case "tool_execution_finished": {
          const from = started.get(e.toolCallId);
          started.delete(e.toolCallId);
          noteCall(run, e.name, e.toolCallId, e.kind);
          const l = line(run, e.kind && e.kind !== "client" ? "server_tool" : e.name);
          if (from !== undefined) {
            l.ms += Math.max(0, e.timestamp - from);
            times.set(e.toolCallId, Math.max(0, e.timestamp - from));
            if (times.size > MAX_TIMES) times.delete(times.keys().next().value!);
          }
          if (!e.ok) l.failed++;
          break;
        }
        case "run_finished": {
          if (t.runId !== rootId) break; // a sub-run ended; the receipt waits for its parent
          finish(run, e.timestamp, e.status);
          break;
        }
      }
    },
  };
}

// ---------- undo ----------

type Entry = Pick<AgReportHistoryEntry, "id">;

/** History entries on the undo stack now that weren't there when the run started, oldest first. */
export function newEntryIds(before: readonly string[], undo: readonly Entry[]): string[] {
  const had = new Set(before);
  return undo.filter((e) => !had.has(e.id)).map((e) => e.id);
}

/**
 * The entry to pass to `api.undo(id)` so exactly the run's changes go: its oldest change. Only when the
 * run's changes are still the newest on the stack; a later change by the family would be undone too.
 */
export function undoTarget(runIds: readonly string[], history: { undo: readonly Entry[] }): string | null {
  if (!runIds.length) return null;
  const tail = history.undo.slice(-runIds.length).map((e) => e.id);
  return tail.length === runIds.length && tail.every((id, i) => id === runIds[i]) ? runIds[0]! : null;
}

/** After an undo, the entry to pass to `api.redo(id)` to bring every one of the run's changes back. */
export function redoTarget(runIds: readonly string[], history: { redo: readonly Entry[] }): string | null {
  if (!runIds.length) return null;
  // The redo stack's last entry is the next to redo, so the run's changes sit newest first at its end.
  const tail = history.redo.slice(-runIds.length).map((e) => e.id);
  const wanted = [...runIds].reverse();
  return tail.length === runIds.length && tail.every((id, i) => id === wanted[i]) ? runIds.at(-1)! : null;
}

// ---------- words ----------

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function receiptLines(r: Receipt): { summary: string; money: string; board: string } {
  const calls = r.tools.reduce((t, l) => t + l.calls, 0);
  const money = r.flagged
    ? `Money actions: ${r.moneyActions} unchecked. Spotter saw a tool it doesn't know (${r.unknown.join(", ")}). This run is flagged.`
    : "Money actions: 0. Every call was a tool that can't move money.";
  return {
    summary: `${plural(calls, "tool call")} in ${secs(r.ms)}. Money actions: ${r.flagged ? `${r.moneyActions} unchecked` : 0}. ${boardWords(r)}`,
    money,
    board: boardWords(r),
  };
}

export const boardWords = (r: Pick<Receipt, "boardChanges" | "boardKnown">) => (r.boardKnown ? `Board changes: ${r.boardChanges}.` : "Board changes: couldn't be checked.");

const SAFE_NAME = /^[a-z][a-z0-9_]{0,47}$/;
const cap = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/**
 * The receipt as the server will take it. A flagged run must never be dropped for having an odd tool name
 * in it, so names that aren't plain snake case become "unrecognised_tool" (still unknown, still flagged),
 * long lists are cut, and numbers are kept in range.
 */
export function forServer(r: Receipt): Receipt {
  const safe = (n: string) => (SAFE_NAME.test(n) ? n : "unrecognised_tool");
  const lines = new Map<string, ToolLine>();
  for (const l of r.tools) {
    const name = safe(l.name);
    const prev = lines.get(name);
    lines.set(name, { name, calls: cap((prev?.calls ?? 0) + l.calls, 1000), ms: cap((prev?.ms ?? 0) + l.ms, 3_600_000), failed: cap((prev?.failed ?? 0) + l.failed, 1000), access: accessOf(name) });
  }
  const tools = [...lines.values()];
  // every unknown line survives the cut
  const kept = [...tools.filter((t) => t.access === "unknown"), ...tools.filter((t) => t.access !== "unknown")].slice(0, 40);
  const unknown = [...new Set(r.unknown.map(safe))].slice(0, 20);
  const flagged = r.flagged || unknown.length > 0 || kept.some((t) => t.access === "unknown");
  return {
    ...r,
    ms: cap(r.ms, 3_600_000),
    turns: cap(r.turns, 1000),
    tokens: { input: cap(r.tokens.input, 1e9), output: cap(r.tokens.output, 1e9) },
    tools: flagged && !kept.some((t) => t.access === "unknown") ? [{ name: "unrecognised_tool", calls: 1, ms: 0, failed: 0, access: "unknown" as const }, ...kept].slice(0, 40) : kept,
    helpers: [...new Set(r.helpers.map((h) => (SAFE_NAME.test(h) ? h : "other_helper")))].slice(0, 20),
    unknown: flagged && !unknown.length ? ["unrecognised_tool"] : unknown,
    moneyActions: flagged ? Math.max(1, cap(r.moneyActions, 1000)) : 0,
    boardChanges: cap(r.boardChanges, 1000),
    flagged,
  };
}

// ---------- checking a receipt on the server ----------

const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const ID = /^[A-Za-z0-9_:.-]{1,100}$/;
const KEYS = ["runId", "threadId", "agentId", "startedAt", "ms", "status", "turns", "tokens", "tools", "helpers", "unknown", "moneyActions", "boardChanges", "boardKnown", "flagged"];
const count = (v: unknown, max = 1e9) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** A receipt the browser sent: exactly the compact shape, names only, nothing free text. */
export function isReceipt(v: unknown): v is Receipt {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (Object.keys(r).length !== KEYS.length || !KEYS.every((k) => k in r)) return false;
  if (![r.runId, r.threadId].every((x) => typeof x === "string" && ID.test(x))) return false;
  if (typeof r.agentId !== "string" || !NAME.test(r.agentId)) return false;
  if (!count(r.startedAt, 1e13) || !count(r.ms, 3_600_000) || !count(r.turns, 1000) || !count(r.moneyActions, 1000) || !count(r.boardChanges, 1000)) return false;
  if (!["ok", "error", "cancelled"].includes(r.status as string) || typeof r.flagged !== "boolean" || typeof r.boardKnown !== "boolean") return false;
  const tk = r.tokens as Record<string, unknown> | null;
  if (!tk || typeof tk !== "object" || Object.keys(tk).length !== 2 || !count(tk.input) || !count(tk.output)) return false;
  const names = (a: unknown, max: number) => Array.isArray(a) && a.length <= max && a.every((x) => typeof x === "string" && NAME.test(x));
  if (!names(r.helpers, 20) || !names(r.unknown, 20)) return false;
  if (!Array.isArray(r.tools) || r.tools.length > 40) return false;
  for (const l of r.tools as unknown[]) {
    const t = l as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || Object.keys(t).length !== 5) return false;
    if (typeof t.name !== "string" || !NAME.test(t.name) || !count(t.calls, 1000) || !count(t.ms, 3_600_000) || !count(t.failed, 1000)) return false;
    if (t.access !== accessOf(t.name)) return false;
  }
  // The flag has to agree with what the receipt itself lists.
  const tools = r.tools as ToolLine[];
  return r.flagged === ((r.unknown as string[]).length > 0) && r.flagged === (r.moneyActions as number) > 0 && r.flagged === tools.some((t) => t.access === "unknown");
}
