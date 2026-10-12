// Plain notes from Spotter's own code in the chat ("I couldn't build that chart, so I took the empty tile
// off"). AG's harness has no call to add a message, so this wraps it: every chat session it hands out shows
// its own messages plus our notes, each kept right after the message that was last when it was added, and
// tells the chat panel to redraw. Notes live for this visit only; the saved chat keeps AG's own messages.
import type { AgAiChatMessage, AgAiChatSession, AgAiHarness, AgAiRunStatus } from "ag-studio";

/** What the chat says under a run that was cut off (the tab closed, a reload, Stop) before it replied. */
export const UNFINISHED_NOTE = "This answer didn't finish. Ask again.";

/**
 * A chat whose last run never replied: nothing is running, and nothing after the family's last question has
 * reply text (only tool calls, like "Placed a tile"). Spotter's lead agent always ends a run with a reply. A run that ended with an error
 * already says so in the chat, so it doesn't count.
 */
export function cutOff(messages: readonly AgAiChatMessage[], status: AgAiRunStatus | undefined): boolean {
  if (status === "running" || status === "awaiting_input") return false;
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  if (lastUser < 0) return false;
  const after = messages.slice(lastUser + 1).filter((m) => m.role === "assistant");
  const parts = after.flatMap((m) => m.parts);
  if (parts.some((p) => p.type === "error")) return false;
  // Any reply text after the question counts, even with a tool call after it.
  return !parts.some((p) => p.type === "text" && p.text.trim() !== "");
}

/** AG's own words on a delegate's row when the delegate ended without calling complete_task. */
export const NO_SUMMARY = "(the delegate finished without a summary)";
/** What a delegate's row says instead when the run built nothing we can name. */
export const NO_SUMMARY_PLAIN = "It finished without writing what it did.";

const noSummary = (r: unknown) => r === NO_SUMMARY || (!!r && typeof r === "object" && (r as { response?: unknown }).response === NO_SUMMARY);
const hasNoSummary = (m: AgAiChatMessage) => m.parts.some((p) => p.type === "tool_call" && p.toolCall.name === "delegate_to" && noSummary(p.toolCall.result));

/** The delegate's row with a plain line in place of AG's words (shown only: the saved chat keeps AG's). */
function plainDelegate(m: AgAiChatMessage, line: string): AgAiChatMessage {
  if (!hasNoSummary(m)) return m;
  return {
    ...m,
    parts: m.parts.map((p) => {
      if (p.type !== "tool_call" || p.toolCall.name !== "delegate_to" || !noSummary(p.toolCall.result)) return p;
      const r = p.toolCall.result;
      return { ...p, toolCall: { ...p.toolCall, result: typeof r === "string" ? line : { ...(r as object), response: line } } };
    }),
  };
}

export type NotableHarness = AgAiHarness & {
  addNote(threadId: string, text: string): void;
  /** Something `answered` reads changed (a receipt landed, a tile filled in): every open chat redraws. */
  refresh(): void;
};
/**
 * answered: the plain line for a thread whose last run built its answer tile and kept its receipt
 * ("Chart added: What Leo spent on games, £9.98."), or null. Such a run is never called unfinished.
 */
export type NotableOptions = { answered?: (threadId: string) => string | null };
type Note = { after: string | null | undefined; message: AgAiChatMessage };
type Listener = (e: { type: "changed" }) => void;

export function notable(inner: AgAiHarness, opts: NotableOptions = {}): NotableHarness {
  const notes = new Map<string, Note[]>();
  const listeners = new Map<string, Set<Listener>>();
  const wrapped = new WeakMap<AgAiChatSession, AgAiChatSession>();
  // The merged list is rebuilt only when AG's list or our notes change, so it keeps its identity otherwise.
  const merged = new Map<string, { from: readonly AgAiChatMessage[]; count: number; cut: boolean; done: string | null; list: AgAiChatMessage[] }>();
  let seq = 0;
  const answeredFor = (threadId: string): string | null => {
    try {
      return opts.answered?.(threadId) ?? null;
    } catch (e) {
      console.error("[watchtower] couldn't work out whether the last answer finished:", e);
      return null;
    }
  };

  const messagesOf = (s: AgAiChatSession): readonly AgAiChatMessage[] => {
    const own = notes.get(s.threadId) ?? [];
    const base = s.messages;
    const cut = cutOff(base, s.status);
    const rewrite = base.some(hasNoSummary);
    if (!own.length && !cut && !rewrite) return base;
    const done = (cut || rewrite) && s.status !== "running" ? answeredFor(s.threadId) : null;
    const hit = merged.get(s.threadId);
    if (hit && hit.from === base && hit.count === own.length && hit.cut === cut && hit.done === done) return hit.list;
    const list = rewrite ? base.map((m) => plainDelegate(m, done ?? NO_SUMMARY_PLAIN)) : [...base];
    for (const n of own) {
      const found = n.after ? list.findIndex((m) => m.id === n.after) + 1 : 0;
      list.splice(n.after === null ? 0 : found > 0 ? found : list.length, 0, n.message);
    }
    // Shown, never saved: the saved chat keeps AG's own messages, and this line goes once an answer arrives.
    // A run that built its tile and kept its receipt finished: its line says what it built, never "didn't finish".
    if (cut) list.push({ id: `spotter-${done ? "answered" : "unfinished"}-${base.at(-1)?.id ?? "start"}`, role: "assistant", parts: [{ type: "text", text: done ?? UNFINISHED_NOTE }], createdAt: base.at(-1)?.createdAt ?? 0 });
    merged.set(s.threadId, { from: base, count: own.length, cut, done, list });
    return list;
  };

  const wrap = (s: AgAiChatSession): AgAiChatSession => {
    let w = wrapped.get(s);
    if (w) return w;
    w = new Proxy(s, {
      get(target, prop) {
        if (prop === "messages") return messagesOf(target);
        if (prop === "addEventListener")
          return (type: "changed", l: Listener) => {
            target.addEventListener(type, l);
            let set = listeners.get(target.threadId);
            if (!set) listeners.set(target.threadId, (set = new Set()));
            set.add(l);
          };
        if (prop === "removeEventListener")
          return (type: "changed", l: Listener) => {
            target.removeEventListener(type, l);
            listeners.get(target.threadId)?.delete(l);
          };
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    wrapped.set(s, w);
    return w;
  };

  return new Proxy(inner, {
    get(target, prop) {
      if (prop === "openThread") return async (id: string) => wrap(await target.openThread(id));
      if (prop === "createThread") return async (opts: Parameters<AgAiHarness["createThread"]>[0]) => wrap(await target.createThread(opts));
      if (prop === "getSession") {
        return (id: string) => {
          const s = target.getSession?.(id);
          return s ? wrap(s) : undefined;
        };
      }
      if (prop === "refresh") {
        return () => {
          for (const ls of listeners.values()) for (const l of ls) l({ type: "changed" });
        };
      }
      if (prop === "addNote") {
        return (threadId: string, text: string) => {
          // null: the chat is empty, so the note goes first. undefined: no way to tell, so it goes last.
          const session = target.getSession?.(threadId);
          const last = session ? (session.messages.at(-1)?.id ?? null) : undefined;
          const list = notes.get(threadId) ?? [];
          list.push({ after: last, message: { id: `spotter-note-${++seq}`, role: "assistant", parts: [{ type: "text", text }], createdAt: Date.now() } });
          notes.set(threadId, list);
          const ls = listeners.get(threadId);
          if (!ls?.size) console.warn("[watchtower] a chat note was added but that chat isn't on screen; it shows when the chat opens:", text);
          for (const l of ls ?? []) l({ type: "changed" });
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as NotableHarness;
}
