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
  // The model refuses a history that ends on its own turn ("does not support assistant message prefill").
  // AG sends one when it makes a delegate call complete_task after a turn that ended in text, so ask in words.
  if (messages.at(-1)?.role === "assistant") messages.push({ role: "user", content: [{ type: "text", text: "Continue." }] });

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

/** Markdown marks taken out, for text AG Studio shows raw (a delegated agent's complete_task summary). */
export function plainText(s: string): string {
  return s
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^(\s*)\*\s+/gm, "$1- ");
}

// How the board works is never the family's business. Round 9: the Data agent's summary ended "One note on "shop": I
// split the total by who was paid. The separate cheapest-shop price-check field wasn't used." A sentence about fields,
// columns, field ids, tool names or Studio's agents is taken out (the roles say so too: agents.ts NO_INTERNALS_RULE).
// Lower case on purpose, so a payee called "Field Kitchen" stays. AG's own chips (@field[payments.amount]) render
// as the field's name, so they are left alone.
const INTERNAL = [
  // "column chart" is a kind of chart, not a column.
  /\bfield\b|\bcolumn\b(?! chart)/,
  /\b(the|these|those|which|other|both|two|separate)\s+(fields|columns)\b/,
  // Real field ids only, never a shop's web address ("cheap-watches.shop", "people.co.uk").
  /(?<![\w.-])(payments|signs|people|watches|paypal)\.(id|when|who|kind|payee|category|method|amount|outcome|moneyKept|heldAtPayPal|paypalExpires|paypalId|marketCheapest|marketMedian|priceGap|marketShop|marketItem|wasItYou|signs|topSign|verdict|newPayee|sample|sign|status|saving|nearlyPaid|target|bestPrice|paymentId|label)\b/,
  /\b(priceGap|marketCheapest|marketMedian|marketShop|marketItem|moneyKept|heldAtPayPal|paypalExpires|paypalId|wasItYou|topSign|newPayee)\b/,
  /\b(fair_prices|real_price|execute_query|delegate_to|place_widget|complete_task|open_case_file|watch_alerts|scam_radar|paypal_status|add_page|my_month)\b/,
  /\b(data|widget|page|planning|lead|Data|Widget|Page|Planning|Lead) agent\b/,
];
/** A sentence saying something broke or is missing always stays, even when it names a tool or agent. */
const FAILURE = /couldn'?t|could not|can'?t|cannot|failed|error|not available|unavailable|missing|didn'?t (finish|work)|timed out|\bdown\b/i;
/** A bare "One note on "shop":" lead in, with no numbers of its own, goes with the note it introduces. */
const NOTE_LEAD = /^(one|a|just a)?\s*(quick |small |short )?note\b/i;
const isNoteLead = (s: string) => NOTE_LEAD.test(s) && !/[\d£$]/.test(s);
const isInternal = (sentence: string) => {
  const s = sentence.replace(/@field\[[^\]]*\]/g, "");
  return !FAILURE.test(s) && INTERNAL.some((re) => re.test(s));
};

/**
 * Sentences about fields, tools or agents taken out; a "One note on ..." lead in to one goes with it. Never empties a
 * reply, and never drops a sentence that says something failed. `onDrop` hears what went, so the server can log it.
 */
export function withoutInternalNotes(text: string, onDrop?: (dropped: string[], keptOriginal: boolean) => void): string {
  const gone: string[] = [];
  const lines = text.split("\n").flatMap((line) => {
    const parts = line.split(/(?<=[.!?])\s+/);
    if (!parts.some(isInternal)) return [line];
    const kept: string[] = [];
    for (const p of parts) {
      if (!isInternal(p)) {
        kept.push(p);
        continue;
      }
      gone.push(p);
      if (kept.length && isNoteLead(kept[kept.length - 1]!)) gone.push(kept.pop()!);
    }
    // A line that was only notes goes, rather than leaving a gap.
    return kept.length ? [kept.join(" ")] : [];
  });
  if (!gone.length) return text;
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  onDrop?.(gone, !out);
  return out ? out : text;
}

/** Logged on the server (fromClaude runs in the route), so a filter that drops too much, or a prompt rule that stopped working, shows up. */
const logDrop = (where: string) => (dropped: string[], keptOriginal: boolean) =>
  console.warn(`[spotter] watchtower ${where}: ${keptOriginal ? "every sentence looked internal, kept the original" : `took out ${dropped.length} internal sentence(s)`}: ${dropped.join(" | ").slice(0, 300)}`);

const plainDeep = (v: unknown): unknown =>
  typeof v === "string"
    ? withoutInternalNotes(plainText(v), logDrop("complete_task"))
    : Array.isArray(v)
      ? v.map(plainDeep)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainDeep(x)]))
        : v;

export function fromClaude(msg: Anthropic.Message): AgLlmResponse {
  const output: AgAiOutputItem[] = [];
  msg.content.forEach((block, i) => {
    if (block.type === "text" && block.text) {
      output.push({ id: `${msg.id}_${i}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: withoutInternalNotes(block.text, logDrop("reply")), annotations: [] }] });
    } else if (block.type === "tool_use") {
      const input = block.name === "complete_task" ? plainDeep(block.input ?? {}) : (block.input ?? {});
      output.push({ id: `${msg.id}_${i}`, kind: "output", type: "function_call", callId: block.id, name: block.name, arguments: JSON.stringify(input), status: "completed" });
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
