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

// R7-N1: the Widget delegate came back without a summary and the lead never wrote a reply, so the chat said
// "(the delegate finished without a summary)" and "This answer didn't finish. Ask again." while the chart,
// the answer card and the receipt had all finished.
describe("a run that built its tile and kept its receipt", () => {
  const NO_SUMMARY = "(the delegate finished without a summary)";
  const call = (id: string, name: string, result?: unknown, args: Record<string, unknown> = {}): AgAiChatMessage => ({ id, role: "assistant", parts: [{ type: "tool_call", toolCall: { toolCallId: id, name, status: "complete", args, result } }], createdAt: 0 });
  const leoRun = (push: (m: AgAiChatMessage) => void) => {
    push(msg("u1", "user", "Show me what Leo spent on games this month, as a chart by shop."));
    push(call("a1", "place_widget", { success: true, data: { widgetId: "answer-1" } }));
    push(call("a2", "delegate_to", { success: true, response: NO_SUMMARY }, { type: { id: "widget" } }));
    push(call("a3", "delegate_to", { success: true, response: "Leo has £9.98 in paid games payments." }, { type: { id: "data" } }));
  };
  const LINE = "Chart added: What Leo spent on games, £9.98.";
  const resultOf = (s: AgAiChatSession, id: string) => (s.messages.find((m) => m.id === id)!.parts[0] as { toolCall: { result: { response: string } } }).toolCall.result.response;

  it("is never called unfinished: the chat ends with a plain line from the result", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h, { answered: (t) => (t === "t1" ? LINE : null) });
    const s = await n.openThread("t1");
    leoRun((m) => sessions.get("t1")!.push(m));
    expect(texts(s).includes(UNFINISHED_NOTE)).toBe(false);
    expect(s.messages.at(-1)!.parts[0]).toEqual({ type: "text", text: LINE });
  });

  it("shows a plain line instead of AG's no summary words on the delegate's row", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h, { answered: () => LINE });
    const s = await n.openThread("t1");
    leoRun((m) => sessions.get("t1")!.push(m));
    expect(resultOf(s, "a2")).toBe(LINE);
    expect(resultOf(s, "a3")).toBe("Leo has £9.98 in paid games payments.");
    expect(JSON.stringify(s.messages)).not.toContain(NO_SUMMARY);
  });

  it("still says it didn't finish when nothing was built, and the delegate row never shows AG's words", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h, { answered: () => null });
    const s = await n.openThread("t1");
    leoRun((m) => sessions.get("t1")!.push(m));
    expect(s.messages.at(-1)!.parts[0]).toEqual({ type: "text", text: UNFINISHED_NOTE });
    expect(resultOf(s, "a2")).toBe("The helper stopped without reporting back.");
  });

  it("names the chart only on this run's widget delegate: a data delegate or an earlier run's row stays plain", async () => {
    const { h, sessions } = fakeHarness();
    const n = notable(h, { answered: () => LINE });
    const s = await n.openThread("t1");
    const push = (m: AgAiChatMessage) => sessions.get("t1")!.push(m);
    push(msg("u0", "user", "An earlier question"));
    push(call("b1", "delegate_to", { success: true, response: NO_SUMMARY }, { type: { id: "widget" } }));
    push(msg("b2", "assistant", "Earlier reply."));
    push(msg("u1", "user", "Show me Leo's games"));
    push(call("a2", "delegate_to", { success: true, response: NO_SUMMARY }, { type: { id: "widget" } }));
    push(call("a3", "delegate_to", { success: true, response: NO_SUMMARY }, { type: { id: "data" } }));
    expect(resultOf(s, "b1")).toBe("The helper stopped without reporting back.");
    expect(resultOf(s, "a2")).toBe(LINE);
    expect(resultOf(s, "a3")).toBe("The helper stopped without reporting back.");
  });

  it("swaps the didn't finish line for the plain line when the receipt lands after the chat settled", async () => {
    const { h, sessions } = fakeHarness();
    let line: string | null = null;
    const n = notable(h, { answered: () => line });
    const s = await n.openThread("t1");
    leoRun((m) => sessions.get("t1")!.push(m));
    expect(s.messages.at(-1)!.parts[0]).toEqual({ type: "text", text: UNFINISHED_NOTE });
    let redraws = 0;
    s.addEventListener("changed", () => redraws++);
    line = LINE;
    n.refresh();
    expect(redraws).toBe(1);
    expect(s.messages.at(-1)!.parts[0]).toEqual({ type: "text", text: LINE });
  });
});
