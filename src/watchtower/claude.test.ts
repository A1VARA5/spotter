import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgLlmRequest } from "ag-studio";
import { fromClaude, toClaude } from "./claude";

const user = (id: string, text: string) => ({ id, kind: "input" as const, type: "message" as const, role: "user" as const, status: "completed" as const, content: [{ type: "text" as const, text }] });

const base: AgLlmRequest = {
  instructions: "You are the lead.",
  responseFormat: { type: "text" },
  input: [user("m1", "What did Leo spend on games?")],
  tools: [
    { name: "execute_query", description: "Run a query", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
    { name: "web_magic", description: "Provider tool", parameters: { type: "object" }, kind: "provided", provider: { x: 1 } },
  ],
  toolChoice: "auto",
};

describe("AG request to Claude", () => {
  it("maps instructions, messages and tools, and drops provider tools", () => {
    const p = toClaude(base);
    expect(p.system).toBe("You are the lead.");
    expect(p.messages).toEqual([{ role: "user", content: [{ type: "text", text: "What did Leo spend on games?" }] }]);
    expect(p.tools.map((t) => t.name)).toEqual(["execute_query"]);
    expect(p.tools[0]).toMatchObject({ input_schema: { type: "object", properties: { q: { type: "string" } } } });
    expect(p.tool_choice).toEqual({ type: "auto" });
  });

  it("turns tool calls and results into tool_use and tool_result blocks, merging same role turns", () => {
    const p = toClaude({
      ...base,
      input: [
        user("m1", "Build it"),
        { id: "o1", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "On it.", annotations: [] }] },
        { id: "r1", kind: "output", type: "reasoning", summary: [{ type: "summary", text: "thinking" }] },
        { id: "c1", kind: "output", type: "function_call", callId: "toolu_1", name: "execute_query", arguments: '{"q":"games"}' },
        { kind: "input", type: "function_call_output", callId: "toolu_1", output: '{"rows":3}', status: "completed" },
      ],
    });
    expect(p.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Build it" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          { type: "tool_use", id: "toolu_1", name: "execute_query", input: { q: "games" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"rows":3}' }] },
    ]);
  });

  it("drops a tool call that never got a result, and a result with no call", () => {
    const p = toClaude({
      ...base,
      input: [
        user("m1", "Go"),
        { id: "c1", kind: "output", type: "function_call", callId: "toolu_lost", name: "execute_query", arguments: "{}" },
        { kind: "input", type: "function_call_output", callId: "toolu_ghost", output: "x", status: "completed" },
        user("m2", "Still there?"),
      ],
    });
    expect(JSON.stringify(p.messages)).not.toContain("toolu_lost");
    expect(JSON.stringify(p.messages)).not.toContain("toolu_ghost");
    expect(p.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Go" }, { type: "text", text: "Still there?" }] }]);
  });

  it("refuses a history whose tool arguments aren't valid JSON instead of guessing", () => {
    expect(() =>
      toClaude({
        ...base,
        input: [
          user("m1", "Go"),
          { id: "c1", kind: "output", type: "function_call", callId: "toolu_1", name: "execute_query", arguments: "{not json" },
          { kind: "input", type: "function_call_output", callId: "toolu_1", output: "x", status: "completed" },
        ],
      }),
    ).toThrow(/arguments/);
  });

  it("asks for a tool in words, because this model can't be forced to call one", () => {
    expect(toClaude({ ...base, toolChoice: "required" }).system).toContain("Call one of your tools now");
    expect(toClaude({ ...base, toolChoice: { name: "execute_query" } }).system).toContain("Call the execute_query tool now");
    expect(toClaude({ ...base, toolChoice: "required" }).tool_choice).toEqual({ type: "auto" });
    expect(toClaude({ ...base, toolChoice: "none" }).tool_choice).toEqual({ type: "none" });
  });

  // R7-N1: AG forces a delegate to call complete_task after a turn that ended in text, so the history ends
  // on the assistant. This model refuses that ("does not support assistant message prefill"), the delegate
  // ends with no summary, and the chat showed "(the delegate finished without a summary)".
  it("always ends on a user message, so a forced complete_task turn isn't refused as a prefill", () => {
    const p = toClaude({
      ...base,
      toolChoice: { name: "complete_task" },
      input: [
        user("m1", "Configure the Leo chart"),
        { id: "c1", kind: "output", type: "function_call", callId: "toolu_1", name: "execute_query", arguments: "{}" },
        { kind: "input", type: "function_call_output", callId: "toolu_1", output: "ok", status: "completed" },
        { id: "o1", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "The chart is set up.", annotations: [] }] },
      ],
    });
    expect(p.messages.at(-1)!.role).toBe("user");
    expect(p.messages.at(-2)).toEqual({ role: "assistant", content: [{ type: "text", text: "The chart is set up." }] });
    expect(p.system).toContain("Call the complete_task tool now");
  });

  it("folds system messages into the system prompt and gives no-argument tools an object schema", () => {
    const p = toClaude({
      ...base,
      input: [{ id: "s1", kind: "input", type: "message", role: "system", status: "completed", content: [{ type: "text", text: "Page 2 is open." }] }, user("m1", "Hi")],
      tools: [{ name: "view_page", description: "View", parameters: {} }],
    });
    expect(p.system).toBe("You are the lead.\n\nPage 2 is open.");
    expect(p.tools[0]!.input_schema).toEqual({ type: "object", properties: {} });
  });

  it("asks for JSON through structured output when AG wants JSON", () => {
    const p = toClaude({ ...base, responseFormat: { type: "json", name: "plan", schema: { type: "object", properties: { steps: { type: "array" } } } } });
    expect(p.output_config.format).toEqual({ type: "json_schema", schema: { type: "object", properties: { steps: { type: "array" } } } });
  });
});

describe("Claude reply to AG response", () => {
  const msg = (content: unknown[], stop_reason: string = "end_turn") =>
    ({ id: "msg_1", model: "claude-opus-5-5", stop_reason, content, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 60, cache_creation_input_tokens: 5 } }) as unknown as Anthropic.Message;

  it("maps text and tool calls, and leaves thinking out", () => {
    const r = fromClaude(
      msg([
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Adding a chart." },
        { type: "tool_use", id: "toolu_9", name: "add_widget", input: { type: "pie-chart" } },
      ], "tool_use"),
    );
    expect(r.status).toBe("completed");
    expect(r.output).toEqual([
      { id: "msg_1_1", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Adding a chart.", annotations: [] }] },
      { id: "msg_1_2", kind: "output", type: "function_call", callId: "toolu_9", name: "add_widget", arguments: '{"type":"pie-chart"}', status: "completed" },
    ]);
    expect(r.usage).toEqual({ inputTokens: 165, outputTokens: 20, cachedInputTokens: 60, cacheWriteTokens: 5 });
  });

  it("hands back a sub agent's complete_task summary as plain text (AG shows it raw in the step)", () => {
    const r = fromClaude(
      msg([{ type: "tool_use", id: "toolu_1", name: "complete_task", input: { summary: "## This month\n**2 paid** payments, `priceGap` £8.50\n* Kettle: __£3__ over", ok: true } }], "tool_use"),
    );
    const args = JSON.parse((r.output[0] as { arguments: string }).arguments);
    expect(args).toEqual({ summary: "This month\n2 paid payments, priceGap £8.50\n- Kettle: £3 over", ok: true });
  });

  it("leaves other tools' arguments alone", () => {
    const r = fromClaude(msg([{ type: "tool_use", id: "t", name: "execute_query", input: { sql: "select '**x**'" } }], "tool_use"));
    expect((r.output[0] as { arguments: string }).arguments).toBe(`{"sql":"select '**x**'"}`);
  });

  it("reports a cut off reply as incomplete and a refusal as a failure", () => {
    expect(fromClaude(msg([{ type: "text", text: "half" }], "max_tokens"))).toMatchObject({ status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } });
    expect(fromClaude(msg([], "refusal"))).toMatchObject({ status: "failed", error: { code: "refusal" } });
  });
});
