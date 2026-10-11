import { describe, expect, it } from "vitest";
import type { AgAiChatMessage, AgAiChatSession, AgAiHarness } from "ag-studio";
import { notable } from "./notes";

// A stand in for AG's harness: one session per thread, whose messages the chat panel reads on "changed".
function fakeHarness() {
  const sessions = new Map<string, AgAiChatSession & { push(m: AgAiChatMessage): void }>();
  const make = (threadId: string) => {
    let messages: AgAiChatMessage[] = [];
    const ls = new Set<() => void>();
    const s = {
      threadId,
      get messages() {
        return messages;
      },
      status: "idle" as const,
      artifacts: [],
      addEventListener: (_t: string, l: () => void) => ls.add(l),
      removeEventListener: (_t: string, l: () => void) => ls.delete(l),
      sendMessage() {},
      cancel() {},
      close() {},
      push(m: AgAiChatMessage) {
        messages = [...messages, m];
        ls.forEach((l) => l());
      },
    };
    sessions.set(threadId, s as never);
    return s;
  };
  const h = {
    threads: [],
    agents: [],
    addEventListener() {},
    removeEventListener() {},
    getAgent: () => undefined,
    getThread: () => undefined,
    openThread: async (id: string) => sessions.get(id) ?? make(id),
    createThread: async () => make("t-new"),
    deleteThread: async () => {},
    getSession: (id: string) => sessions.get(id),
  };
  return { h: h as unknown as AgAiHarness, sessions };
}
const msg = (id: string, role: "user" | "assistant", text: string): AgAiChatMessage => ({ id, role, parts: [{ type: "text", text }], createdAt: 0 });
const texts = (s: AgAiChatSession) => s.messages.map((m) => (m.parts[0] as { text: string }).text);

describe("a plain note from Spotter's code in the chat", () => {
  it("appears after the last message of that thread and tells the panel to redraw", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h);
    const s = await n.openThread("t1");
    sessions.get("t1")!.push(msg("1", "user", "What did Leo spend?"));
    sessions.get("t1")!.push(msg("2", "assistant", "£9.98."));
    let redraws = 0;
    s.addEventListener("changed", () => redraws++);
    n.addNote("t1", "I couldn't build the chart.");
    expect(texts(s)).toEqual(["What did Leo spend?", "£9.98.", "I couldn't build the chart."]);
    expect(s.messages[2]!.role).toBe("assistant");
    expect(redraws).toBe(1);
  });

  it("stays where it was put when the chat goes on", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h);
    const s = await n.openThread("t1");
    sessions.get("t1")!.push(msg("1", "assistant", "First answer."));
    n.addNote("t1", "Note.");
    sessions.get("t1")!.push(msg("2", "user", "Next question"));
    expect(texts(s)).toEqual(["First answer.", "Note.", "Next question"]);
  });

  it("gives the same messages array until something changes (the panel compares them)", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h);
    const s = await n.openThread("t1");
    sessions.get("t1")!.push(msg("1", "assistant", "Hi"));
    n.addNote("t1", "Note.");
    expect(s.messages).toBe(s.messages);
  });

  it("goes at the end of the chat when the harness can't say which message was last", async () => {
    const { h, sessions } = fakeHarness();
    const s0 = await h.openThread("t1");
    (h as { getSession?: unknown }).getSession = undefined;
    const n = notable(h);
    const s = await n.openThread("t1");
    sessions.get("t1")!.push(msg("1", "assistant", "Answer."));
    n.addNote("t1", "Note.");
    expect(texts(s)).toEqual(["Answer.", "Note."]);
    expect(s0.threadId).toBe("t1");
  });

  it("leaves other threads alone", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h);
    const a = await n.openThread("a");
    const b = await n.openThread("b");
    sessions.get("a")!.push(msg("1", "assistant", "A"));
    sessions.get("b")!.push(msg("1", "assistant", "B"));
    n.addNote("a", "Note.");
    expect(texts(b)).toEqual(["B"]);
    expect(texts(a)).toEqual(["A", "Note."]);
  });
});
