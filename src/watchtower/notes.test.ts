import { describe, expect, it } from "vitest";
import type { AgAiChatMessage, AgAiChatSession, AgAiHarness } from "ag-studio";
import { UNFINISHED_NOTE, cutOff, notable } from "./notes";

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
    // the next question is being answered
    (sessions.get("t1") as unknown as { status: string }).status = "running";
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

// R5-N3: a chat cut off mid run (the tab closed) ended at "Placed a tile" on reload, with no reply and no word
// that it didn't finish.
describe("a chat cut off mid run", () => {
  const tool = (id: string, name: string): AgAiChatMessage => ({ id, role: "assistant", parts: [{ type: "tool_call", toolCall: { toolCallId: id, name, status: "complete", args: {} } }], createdAt: 0 });
  it("is one whose last word is the family's question, or an assistant turn with tool calls and no reply", () => {
    expect(cutOff([msg("u1", "user", "Show me Leo's games")], "idle")).toBe(true);
    expect(cutOff([msg("u1", "user", "Show me Leo's games"), tool("a1", "place_widget")], "idle")).toBe(true);
    expect(cutOff([msg("u1", "user", "Show me Leo's games"), tool("a1", "place_widget"), msg("a2", "assistant", "Leo spent £9.98.")], "idle")).toBe(false);
    expect(cutOff([msg("u1", "user", "Show me Leo's games"), msg("a2", "assistant", "  ")], "idle")).toBe(true);
    // a reply followed by a last tool call (a tidy up) still answered
    expect(cutOff([msg("u1", "user", "Show me Leo's games"), msg("a2", "assistant", "Leo spent £9.98."), tool("a3", "rename_thread")], "idle")).toBe(false);
  });
  it("isn't cut off while the run is still going, when the chat is empty, or when the run ended with an error it already shows", () => {
    expect(cutOff([msg("u1", "user", "Show me Leo's games")], "running")).toBe(false);
    expect(cutOff([msg("u1", "user", "Show me Leo's games")], "awaiting_input")).toBe(false);
    expect(cutOff([], "idle")).toBe(false);
    expect(cutOff([msg("u1", "user", "hi"), { id: "e", role: "assistant", parts: [{ type: "error", message: "The model didn't answer." }], createdAt: 0 }], "idle")).toBe(false);
  });
  it("ends with Spotter's plain line saying it didn't finish, and the line goes once an answer arrives", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h);
    const s = await n.openThread("t1");
    sessions.get("t1")!.push(msg("u1", "user", "Show me Leo's games"));
    sessions.get("t1")!.push(tool("a1", "place_widget"));
    expect(s.messages.at(-1)!.parts[0]).toEqual({ type: "text", text: UNFINISHED_NOTE });
    expect(s.messages).toBe(s.messages); // same list while nothing changes, so the panel doesn't redraw for nothing
    sessions.get("t1")!.push(msg("a2", "assistant", "Leo spent £9.98."));
    expect(texts(s).includes(UNFINISHED_NOTE)).toBe(false);
  });
  it("says exactly that it didn't finish and to ask again", () => {
    expect(UNFINISHED_NOTE).toBe("This answer didn't finish. Ask again.");
  });
});
