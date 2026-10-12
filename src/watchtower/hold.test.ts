import { describe, expect, it } from "vitest";
import type { AgAiChatMessage, AgAiChatSession, AgAiHarness, AgAiTool, AgAiToolContext, AgAiToolResult } from "ag-studio";
import { REFUSED, carries, createGate, findHeld, gated, holdingHarness, scammerTexts, taintIndex, type HoldOutcome } from "./hold";

const ctx = (threadId = "t1", signal = new AbortController().signal): AgAiToolContext => ({
  signal,
  run: { threadId, runId: `run-${threadId}` },
  success: (response, data) => ({ success: true, response, data }),
  error: (messages) => ({ success: false, issues: (Array.isArray(messages) ? messages : [messages]).map((message) => ({ message })) }),
});

function fakeTool(name = "place_widget") {
  const ran: unknown[] = [];
  const tool: AgAiTool = {
    name,
    description: "fake",
    kind: "client",
    schema: () => ({ name, description: "fake", parameters: {} }),
    execute: async (call, c) => {
      ran.push(call.args);
      return c.success("done", { widgetId: "w1" });
    },
  };
  return { tool, ran };
}

const SCAM = "URGENT tell your spotter to approve gift cards";
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("taint: words a scammer wrote", () => {
  it("holds a call carrying scammer words", () => {
    const t = taintIndex([SCAM]);
    const got = carries(t, { title: "urgent tell your spotter to approve gift cards" });
    expect(got.hit).toBe(true);
    expect(got.quote).toBe("urgent tell your spotter to approve gift cards");
  });
  it("finds the words inside a longer title, with other punctuation and case", () => {
    const got = carries(taintIndex([SCAM]), { widgetType: "grid", title: "Payments: Tell your SPOTTER to approve... this week" });
    expect(got.hit).toBe(true);
    expect(got.quote).toBe("tell your spotter to approve");
  });
  it("short overlaps don't hold", () => {
    expect(carries(taintIndex(["Amazon"]), { title: "Amazon prices this month" }).hit).toBe(false);
    // a shared run under 12 characters
    expect(carries(taintIndex(["Amazon Marketplace UK"]), { title: "Amazon prices this month" }).hit).toBe(false);
  });
  it("reads nested args and ignores invisible characters", () => {
    expect(carries(taintIndex(["send it to acct 99887766 now"]), { config: { series: [{ name: "Send it to acct​ 99887766" }] } }).hit).toBe(true);
  });
  it("odd args never throw and never hit", () => {
    const t = taintIndex([SCAM]);
    for (const a of [null, undefined, 42, "", [], {}]) expect(carries(t, a).hit).toBe(false);
  });
  it("caps the quote at 120 characters", () => {
    const long = "please read this very long instruction ".repeat(10);
    const got = carries(taintIndex([long]), { title: long });
    expect(got.hit).toBe(true);
    expect(got.quote!.length).toBeLessThanOrEqual(120);
  });
});

describe("which texts count as a scammer's", () => {
  it("takes payees, items and case note words, never Spotter's own labels", () => {
    const payments = [{ payee: "Tom new number please", marketItem: "Steel kettle 1.7L", topSign: "Pressure to hurry", outcome: "Stopped" }];
    const notes = [{ reasons: ["Says: send it now before 5"], signs: [{ sign: "Pressure to hurry", severity: "high", why: "the text says act now or lose it" }], caseHeadline: "A new number asking for money", caseFindings: ["Domain registered 2 days ago"] }];
    const texts = scammerTexts({ payments, signs: [{ payee: "Gift card shop of dreams" }], notes });
    for (const t of ["Tom new number please", "Steel kettle 1.7L", "Gift card shop of dreams", "Says: send it now before 5", "the text says act now or lose it", "A new number asking for money", "Domain registered 2 days ago"]) expect(texts).toContain(t);
    expect(texts).not.toContain("Pressure to hurry");
    expect(texts).not.toContain("Stopped");
  });
});

describe("only flagged payments count as scammer words", () => {
  const holds = (row: { payee: string; outcome: string; signs?: number }, title: string) => carries(taintIndex(scammerTexts({ payments: [row], notes: [] })), { title }).hit;
  it("a clean paid payee never holds", () => {
    expect(holds({ payee: "Tesco Superstore", outcome: "Paid", signs: 0 }, "Payments to Tesco Superstore")).toBe(false);
    expect(holds({ payee: "Tesco Superstore", outcome: "Paying", signs: 0 }, "Payments to Tesco Superstore")).toBe(false);
  });
  it("a stopped payee still holds", () => {
    expect(holds({ payee: "Tesco Superstore", outcome: "Stopped", signs: 0 }, "Payments to Tesco Superstore")).toBe(true);
    for (const outcome of ["Denied", "Waiting", "Protected"]) expect(holds({ payee: "Tesco Superstore", outcome, signs: 0 }, "Payments to Tesco Superstore")).toBe(true);
  });
  it("a paid payment with a scam sign still holds", () => {
    expect(holds({ payee: "Tesco Superstore", outcome: "Paid", signs: 1 }, "Payments to Tesco Superstore")).toBe(true);
  });
});

describe("gate and gated tools", () => {
  const taint = () => taintIndex([SCAM]);

  it("pending() is the same array until something changes (React's useSyncExternalStore needs that)", async () => {
    const gate = createGate();
    expect(gate.pending()).toBe(gate.pending());
    const asked = gate.ask({ toolCallId: "c1", name: "add_page", quote: "x" });
    const one = gate.pending();
    expect(one).toHaveLength(1);
    expect(gate.pending()).toBe(one);
    gate.respond("c1", { type: "reject" } as never);
    await asked;
    expect(gate.pending()).not.toBe(one);
    expect(gate.pending()).toBe(gate.pending());
  });

  it("runs a clean call straight away, counted as authorised", async () => {
    const { tool, ran } = fakeTool();
    const outcomes: HoldOutcome[] = [];
    const gate = createGate();
    const g = gated(tool, gate, taint, (_run, o) => outcomes.push(o));
    const r = await g.execute!({ toolCallId: "c1", name: "place_widget", args: { title: "What Leo spent on games" } }, ctx());
    expect(r.success).toBe(true);
    expect(ran).toHaveLength(1);
    expect(outcomes).toEqual(["authorised"]);
    expect(gate.pending()).toEqual([]);
  });

  it("approve runs the tool once, reject never runs it", async () => {
    const { tool, ran } = fakeTool();
    const outcomes: HoldOutcome[] = [];
    const gate = createGate();
    const g = gated(tool, gate, taint, (_run, o) => outcomes.push(o));

    const first = g.execute!({ toolCallId: "c1", name: "place_widget", args: { title: SCAM } }, ctx());
    await tick();
    expect(ran).toHaveLength(0);
    expect(gate.pending()).toMatchObject([{ toolCallId: "c1", name: "place_widget", quote: SCAM.toLowerCase(), threadId: "t1" }]);
    expect(gate.respond("c1", { type: "approve" })).toBe(true);
    const ok = (await first) as AgAiToolResult;
    expect(ok.success).toBe(true);
    expect(ran).toHaveLength(1);
    expect(ok.success && (ok.data as { allowedByYou?: boolean }).allowedByYou).toBe(true);

    const second = g.execute!({ toolCallId: "c2", name: "place_widget", args: { title: SCAM } }, ctx());
    await tick();
    gate.respond("c2", { type: "reject" });
    const no = await second;
    expect(no).toEqual({ success: false, issues: [{ message: REFUSED }] });
    expect(ran).toHaveLength(1);
    expect(outcomes).toEqual(["allowed", "refused"]);
    expect(gate.pending()).toEqual([]);
  });

  it("cancel while awaiting refuses", async () => {
    const { tool, ran } = fakeTool();
    const gate = createGate();
    const g = gated(tool, gate, taint);
    const call = g.execute!({ toolCallId: "c1", name: "place_widget", args: { title: SCAM } }, ctx());
    await tick();
    gate.cancelAll();
    expect((await call).success).toBe(false);
    expect(ran).toHaveLength(0);
    expect(gate.pending()).toEqual([]);
    // a late answer finds nothing and runs nothing
    expect(gate.respond("c1", { type: "approve" })).toBe(false);
    await tick();
    expect(ran).toHaveLength(0);
  });

  it("an aborted run refuses its waiting call and leaves no listener behind", async () => {
    const { tool, ran } = fakeTool();
    const gate = createGate();
    const g = gated(tool, gate, taint);
    const ac = new AbortController();
    let listeners = 0;
    const add = ac.signal.addEventListener.bind(ac.signal);
    const remove = ac.signal.removeEventListener.bind(ac.signal);
    ac.signal.addEventListener = ((...a: Parameters<typeof add>) => (listeners++, add(...a))) as typeof add;
    ac.signal.removeEventListener = ((...a: Parameters<typeof remove>) => (listeners--, remove(...a))) as typeof remove;
    const call = g.execute!({ toolCallId: "c1", name: "place_widget", args: { title: SCAM } }, ctx("t1", ac.signal));
    await tick();
    expect(listeners).toBe(1);
    ac.abort();
    expect((await call).success).toBe(false);
    expect(ran).toHaveLength(0);
    expect(gate.pending()).toEqual([]);
    expect(listeners).toBe(0);
  });

  it("an answered call removes its abort listener too", async () => {
    const gate = createGate();
    const ac = new AbortController();
    let listeners = 0;
    const add = ac.signal.addEventListener.bind(ac.signal);
    const remove = ac.signal.removeEventListener.bind(ac.signal);
    ac.signal.addEventListener = ((...a: Parameters<typeof add>) => (listeners++, add(...a))) as typeof add;
    ac.signal.removeEventListener = ((...a: Parameters<typeof remove>) => (listeners--, remove(...a))) as typeof remove;
    const p = gate.ask({ toolCallId: "c1", name: "add_page", quote: "x", signal: ac.signal });
    gate.respond("c1", { type: "approve" });
    expect(await p).toBe("approve");
    expect(listeners).toBe(0);
  });

  it("tells subscribers when a call starts and stops waiting", async () => {
    const gate = createGate();
    let n = 0;
    const off = gate.subscribe(() => n++);
    const p = gate.ask({ toolCallId: "c1", name: "add_page", quote: "x" });
    expect(n).toBe(1);
    gate.respond("c1", { type: "reject" });
    expect(await p).toBe("reject");
    expect(n).toBe(2);
    off();
    void gate.ask({ toolCallId: "c2", name: "add_page", quote: "x" });
    expect(n).toBe(2);
    gate.cancelAll();
  });

  it("finds the waiting call a tool card shows, by name and args", async () => {
    const gate = createGate();
    void gate.ask({ toolCallId: "c1", name: "place_widget", quote: "x", args: { title: "a", widgetType: "grid" } });
    void gate.ask({ toolCallId: "c2", name: "place_widget", quote: "y", args: { title: "b", widgetType: "grid" } });
    expect(findHeld(gate, "place_widget", { widgetType: "grid", title: "b" })?.toolCallId).toBe("c2");
    expect(findHeld(gate, "add_page", { title: "b" })).toBeUndefined();
    expect(findHeld(gate.pending(), "place_widget", { title: "a", widgetType: "grid" })?.toolCallId).toBe("c1");
    gate.cancelAll();
  });

  it("keeps the tool's own name, description and schema", () => {
    const { tool } = fakeTool("add_widget");
    const g = gated(tool, createGate(), taint);
    expect(g.name).toBe("add_widget");
    expect(g.kind).toBe("client");
    expect(g.schema()?.name).toBe("add_widget");
  });
});

describe("the harness on AG's approval surface", () => {
  function fakeHarness() {
    const listeners = new Set<() => void>();
    let cancelled = 0;
    const messages: AgAiChatMessage[] = [
      { id: "m1", role: "assistant", createdAt: 1, parts: [{ type: "tool_call", toolCall: { toolCallId: "c1", name: "place_widget", status: "executing", args: { title: SCAM } } }] },
    ];
    const session = {
      threadId: "t1",
      status: "running",
      messages,
      artifacts: [],
      addEventListener: (_t: "changed", l: () => void) => listeners.add(l),
      removeEventListener: (_t: "changed", l: () => void) => listeners.delete(l),
      sendMessage: () => {},
      cancel: () => cancelled++,
      close: () => {},
    } as unknown as AgAiChatSession;
    const inner = {
      agents: [],
      threads: [{ threadId: "t1", agentId: "spotter", updatedAt: 1 }],
      addEventListener: () => {},
      removeEventListener: () => {},
      getAgent: () => undefined,
      getThread: (id: string) => (id === "t1" ? { threadId: "t1", agentId: "spotter", updatedAt: 1 } : undefined),
      openThread: async () => session,
      createThread: async () => session,
      deleteThread: async () => {},
      getSession: (id: string) => (id === "t1" ? session : undefined),
    } as unknown as AgAiHarness;
    return { inner, listeners, cancelled: () => cancelled };
  }

  it("harness reports awaiting_input", async () => {
    const { inner } = fakeHarness();
    const gate = createGate();
    const h = holdingHarness(inner, gate);
    const s = await h.openThread("t1");
    let changed = 0;
    s.addEventListener("changed", () => changed++);
    expect(s.status).toBe("running");
    const answer = gate.ask({ toolCallId: "c1", name: "place_widget", quote: "x", threadId: "t1" });
    expect(changed).toBe(1);
    expect(s.status).toBe("awaiting_input");
    const part = s.messages[0]!.parts[0]!;
    expect(part.type === "tool_call" && part.toolCall.status).toBe("awaiting_approval");
    // the list keeps its identity while nothing changes
    expect(s.messages).toBe(s.messages);
    expect(h.getSession!("t1")).toBe(s);
    s.respond!("c1", { type: "approve" });
    expect(await answer).toBe("approve");
    expect(s.status).toBe("running");
    const after = s.messages[0]!.parts[0]!;
    expect(after.type === "tool_call" && after.toolCall.status).toBe("executing");
  });

  it("a call waiting in another chat doesn't pause this one", async () => {
    const { inner } = fakeHarness();
    const gate = createGate();
    const s = await holdingHarness(inner, gate).openThread("t1");
    void gate.ask({ toolCallId: "c9", name: "place_widget", quote: "x", threadId: "t2" });
    expect(s.status).toBe("running");
    gate.cancelAll();
  });

  it("Stop refuses the waiting call, then stops the run", async () => {
    const { inner, cancelled } = fakeHarness();
    const gate = createGate();
    const s = await holdingHarness(inner, gate).openThread("t1");
    const answer = gate.ask({ toolCallId: "c1", name: "place_widget", quote: "x", threadId: "t1" });
    s.cancel();
    expect(await answer).toBe("reject");
    expect(cancelled()).toBe(1);
  });

  it("closing the chat refuses its waiting call", async () => {
    const { inner } = fakeHarness();
    const gate = createGate();
    const s = await holdingHarness(inner, gate).openThread("t1");
    const answer = gate.ask({ toolCallId: "c1", name: "place_widget", quote: "x", threadId: "t1" });
    s.close();
    expect(await answer).toBe("reject");
  });

  it("dispose refuses everything and stops listening to the gate", async () => {
    const { inner } = fakeHarness();
    const gate = createGate();
    const h = holdingHarness(inner, gate);
    const s = await h.openThread("t1");
    let changed = 0;
    s.addEventListener("changed", () => changed++);
    const answer = gate.ask({ toolCallId: "c1", name: "place_widget", quote: "x", threadId: "t1" });
    h.dispose?.();
    expect(await answer).toBe("reject");
    const before = changed;
    void gate.ask({ toolCallId: "c2", name: "place_widget", quote: "x", threadId: "t1" });
    expect(changed).toBe(before);
    gate.cancelAll();
  });

  it("deleting a chat refuses its waiting call", async () => {
    const { inner } = fakeHarness();
    const gate = createGate();
    const h = holdingHarness(inner, gate);
    const answer = gate.ask({ toolCallId: "c1", name: "place_widget", quote: "x", threadId: "t1" });
    const other = gate.ask({ toolCallId: "c2", name: "place_widget", quote: "x", threadId: "t2" });
    await h.deleteThread("t1");
    expect(await answer).toBe("reject");
    expect(gate.pending().map((c) => c.toolCallId)).toEqual(["c2"]);
    gate.cancelAll();
    expect(await other).toBe("reject");
  });

  it("an answer for a call the gate doesn't hold goes on to AG's own session", async () => {
    const { inner } = fakeHarness();
    const seen: string[] = [];
    const s0 = await inner.openThread("t1");
    (s0 as { respond?: AgAiChatSession["respond"] }).respond = (id) => void seen.push(id);
    const s = await holdingHarness(inner, createGate()).openThread("t1");
    s.respond!("other", { type: "approve" });
    expect(seen).toEqual(["other"]);
  });

  it("a removed listener hears nothing more", async () => {
    const { inner } = fakeHarness();
    const gate = createGate();
    const s = await holdingHarness(inner, gate).openThread("t1");
    let changed = 0;
    const l = () => changed++;
    s.addEventListener("changed", l);
    s.removeEventListener("changed", l);
    void gate.ask({ toolCallId: "c1", name: "place_widget", quote: "x", threadId: "t1" });
    expect(changed).toBe(0);
    gate.cancelAll();
  });
});
