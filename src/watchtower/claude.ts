// AG Studio's agents talk an OpenAI Responses style protocol (AgLlmRequest / AgLlmResponse). AG ships no
// Claude adapter, so this maps one turn each way. It runs on the server (the route holds the API key);
// Studio runs the tools in the browser and sends their results back next turn.
// Thinking blocks are never sent back: Studio's history has nowhere to keep their signatures, and a
// history without them is allowed (the model just doesn't reuse old reasoning). It also keeps the
// history append only, so the prompt cache keeps working.
import type Anthropic from "@anthropic-ai/sdk";
import type { AgAiOutputItem, AgLlmRequest, AgLlmResponse } from "ag-studio";

type Block = Anthropic.ContentBlockParam;
export type ClaudeTurn = {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  tool_choice: Anthropic.ToolChoice;
  output_config: { effort: "low"; format?: { type: "json_schema"; schema: Record<string, unknown> } };
};

function objectSchema(schema: unknown): Anthropic.Tool.InputSchema {
  const s = (schema && typeof schema === "object" ? schema : {}) as Record<string, unknown>;
  if (s.type === "object") return s as Anthropic.Tool.InputSchema;
  if (Object.keys(s).length === 0) return { type: "object", properties: {} };
  return { ...s, type: "object" } as Anthropic.Tool.InputSchema;
}

/** The arguments came from our own JSON.stringify, so anything else means the history is broken. Never guess. */
function parseArgs(name: string, raw: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(raw || "{}");
  } catch {
    throw new Error(`The ${name} tool call has arguments that aren't valid JSON.`);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`The ${name} tool call has arguments that aren't an object.`);
  return v as Record<string, unknown>;
}

export function toClaude(req: AgLlmRequest): ClaudeTurn {
  const system: string[] = req.instructions ? [req.instructions] : [];
  const called = new Set<string>();
  const answered = new Set<string>();
  for (const item of req.input) {
    if (item.type === "function_call") called.add(item.callId);
    if (item.type === "function_call_output") answered.add(item.callId);
  }

  const messages: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", block: Block) => {
    const last = messages.at(-1);
    if (last && last.role === role) (last.content as Block[]).push(block);
    else messages.push({ role, content: [block] });
  };

  for (const item of req.input) {
    if (item.type === "message" && item.kind === "input") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : "")).filter(Boolean).join("\n");
      if (!text) continue;
      if (item.role === "system") system.push(text);
      else push("user", { type: "text", text });
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
      if (text) push("assistant", { type: "text", text });
    } else if (item.type === "function_call") {
      if (answered.has(item.callId)) push("assistant", { type: "tool_use", id: item.callId, name: item.name, input: parseArgs(item.name, item.arguments) });
    } else if (item.type === "function_call_output") {
      if (called.has(item.callId)) push("user", { type: "tool_result", tool_use_id: item.callId, content: item.output });
    }
    // reasoning items are skipped (see the note at the top)
  }
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "Continue." }] });

  const choice = req.toolChoice ?? "auto";
  if (choice === "required") system.push("Call one of your tools now.");
  else if (typeof choice === "object") system.push(`Call the ${choice.name} tool now.`);

  const output_config: ClaudeTurn["output_config"] = { effort: "low" };
  if (req.responseFormat?.type === "json") output_config.format = { type: "json_schema", schema: req.responseFormat.schema as Record<string, unknown> };

  return {
    system: system.join("\n\n"),
    messages,
    tools: (req.tools ?? []).filter((t) => t.kind !== "provided").map((t) => ({ name: t.name, description: t.description, input_schema: objectSchema(t.parameters) })),
    tool_choice: choice === "none" ? { type: "none" } : { type: "auto" },
    output_config,
  };
}

export function fromClaude(msg: Anthropic.Message): AgLlmResponse {
  const output: AgAiOutputItem[] = [];
  msg.content.forEach((block, i) => {
    if (block.type === "text" && block.text) {
      output.push({ id: `${msg.id}_${i}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: block.text, annotations: [] }] });
    } else if (block.type === "tool_use") {
      output.push({ id: `${msg.id}_${i}`, kind: "output", type: "function_call", callId: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}), status: "completed" });
    }
  });
  const u = msg.usage;
  const res: AgLlmResponse = {
    id: msg.id,
    createdAt: Date.now(),
    output,
    status: "completed",
    model: msg.model,
    usage: {
      inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      cachedInputTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
  if (msg.stop_reason === "max_tokens") return { ...res, status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } };
  if (msg.stop_reason === "refusal") return { ...res, status: "failed", error: { code: "refusal", message: "The assistant declined that request." } };
  return res;
}
