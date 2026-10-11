// Shared bits of the two demo agents (scripts/agent-demo.mts on Spotter's own tools, scripts/toolkit-agent-demo.mts on
// PayPal's Agent Toolkit tools): a minimal MCP client, the booby trapped demo shop read the way an agent reads it,
// and a short Claude tool loop that writes the transcript. Nothing here moves money; Spotter decides everything.
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MODEL = "claude-opus-5-5";
export const MAX_TURNS = 10;
export const DEMO_SHOP = "https://spotter-pay.vercel.app/demo-shop/gadgetbarn";

export const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Minimal MCP over Streamable HTTP: one JSON-RPC POST per call; the answer comes back as JSON or one SSE event. */
export function makeMcp(endpoint: string, token: string) {
  let rpcId = 0;
  return async function mcp(method: string, params: unknown) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Spotter answered ${res.status} to ${method}: ${raw.slice(0, 200)}`);
    const data = raw.trim().startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5);
    if (!data) throw new Error(`No JSON-RPC answer to ${method}`);
    const j = JSON.parse(data) as { result?: any; error?: { message: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  };
}

/**
 * The demo shop's text the way a careless agent reads a page: every bit of text in the HTML, including the line the
 * shop hides from people with CSS. That hidden line is what Spotter's check should catch.
 */
export async function shopPageText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The demo shop answered ${res.status}`);
  const html = await res.text();
  return html
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export type Tool = { name: string; description: string; input_schema: any };

/** Runs Claude with the given tools, sending every tool call to Spotter, and writes the transcript next to the repo. */
export async function runAgent(opts: {
  mcp: ReturnType<typeof makeMcp>;
  tools: Tool[];
  system: string;
  task: string;
  file: string;
  meta: Record<string, unknown>;
  /** Where the transcript goes. Default: the submission folder next to the repo. */
  dir?: string;
}) {
  const client = new Anthropic({ maxRetries: 1 });
  const messages: Array<{ role: "user" | "assistant"; content: any }> = [{ role: "user", content: opts.task }];
  const transcript: Array<Record<string, unknown>> = [{ role: "user", text: opts.task }];
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = (await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: opts.system,
      tools: opts.tools,
      messages,
      output_config: { effort: "low" },
    } as never)) as unknown as { content: any[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } };
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    messages.push({ role: "assistant", content: res.content }); // thinking blocks go back unchanged inside a tool loop

    const results: any[] = [];
    for (const block of res.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`\nAgent: ${block.text}`);
        transcript.push({ role: "agent", text: block.text });
      } else if (block.type === "tool_use") {
        console.log(`\n-> ${block.name} ${JSON.stringify(block.input)}`);
        transcript.push({ role: "agent", tool: block.name, input: block.input });
        let out: string;
        let isError = false;
        try {
          const r = await opts.mcp("tools/call", { name: block.name, arguments: block.input });
          out = (r.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
          isError = Boolean(r.isError);
        } catch (e) {
          out = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        console.log(`<- Spotter: ${out}`);
        transcript.push({ role: "spotter", tool: block.name, result: safeJson(out), is_error: isError });
        results.push({ type: "tool_result", tool_use_id: block.id, content: out, is_error: isError });
      }
    }
    if (res.stop_reason !== "tool_use" || !results.length) break;
    messages.push({ role: "user", content: results });
  }

  const day = new Date().toISOString().slice(0, 10);
  const dir = opts.dir ?? path.resolve(import.meta.dirname, "../../paypal-spotter-submission");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${opts.file}-${day}.json`);
  writeFileSync(
    file,
    JSON.stringify({ model: MODEL, effort: "low", ...opts.meta, ran_at: new Date().toISOString(), tools: opts.tools.map((t) => t.name), system: opts.system, transcript, usage }, null, 2),
  );
  console.log(`\nTranscript: ${file}\nTokens: ${usage.input_tokens} in, ${usage.output_tokens} out`);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
