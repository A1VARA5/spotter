// Plain notes from Spotter's own code in the chat ("I couldn't build that chart, so I took the empty tile
// off"). AG's harness has no call to add a message, so this wraps it: every chat session it hands out shows
// its own messages plus our notes, each kept right after the message that was last when it was added, and
// tells the chat panel to redraw. Notes live for this visit only; the saved chat keeps AG's own messages.
import type { AgAiChatMessage, AgAiChatSession, AgAiHarness } from "ag-studio";

export type NotableHarness = AgAiHarness & { addNote(threadId: string, text: string): void };
type Note = { after: string | null | undefined; message: AgAiChatMessage };
type Listener = (e: { type: "changed" }) => void;

export function notable(inner: AgAiHarness): NotableHarness {
  const notes = new Map<string, Note[]>();
  const listeners = new Map<string, Set<Listener>>();
  const wrapped = new WeakMap<AgAiChatSession, AgAiChatSession>();
  // The merged list is rebuilt only when AG's list or our notes change, so it keeps its identity otherwise.
  const merged = new Map<string, { from: readonly AgAiChatMessage[]; count: number; list: AgAiChatMessage[] }>();
  let seq = 0;

  const messagesOf = (s: AgAiChatSession): readonly AgAiChatMessage[] => {
    const own = notes.get(s.threadId);
    const base = s.messages;
    if (!own?.length) return base;
    const hit = merged.get(s.threadId);
    if (hit && hit.from === base && hit.count === own.length) return hit.list;
    const list = [...base];
    for (const n of own) {
      const found = n.after ? list.findIndex((m) => m.id === n.after) + 1 : 0;
      list.splice(n.after === null ? 0 : found > 0 ? found : list.length, 0, n.message);
    }
    merged.set(s.threadId, { from: base, count: own.length, list });
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
