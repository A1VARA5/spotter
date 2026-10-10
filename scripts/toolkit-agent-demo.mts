// A shopping agent built on PayPal's official Agent Toolkit tool definitions (@paypal/agent-toolkit 1.11.0),
// pointed at Spotter's guard (/api/toolkit/mcp) instead of PayPal. Claude sees PayPal's own create_order /
// get_order / pay_order definitions; every call goes to Spotter, which checks it and holds it for the spotter.
//
// PAID: one short Claude run (claude-opus-5-5, effort low, at most 8 turns). Sandbox PayPal only.
//
//   Use an existing agent key (the agent's allowance must be in USD, the toolkit's create_order only takes USD):
//     TOOLKIT_AGENT_TOKEN=spt_... npx tsx --env-file=.env.local scripts/toolkit-agent-demo.mts --url https://spotter-pay.vercel.app
//   Or make a fresh demo family with a USD agent first (writes to DATABASE_URL, Neon only):
//     npx tsx --env-file=.env.local scripts/toolkit-agent-demo.mts --setup --url http://localhost:3417
//
//   Add --dry to check the key, endpoint and tool definitions without calling Claude (free).
//
// Writes the transcript to ../paypal-spotter-submission/toolkit-agent-run-<date>.json
import Anthropic from "@anthropic-ai/sdk";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { zodToJsonSchema } from "zod-to-json-schema";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 8;
const TOOLKIT_VERSION = "1.11.0";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const base = (arg("--url") ?? "http://localhost:3417").replace(/\/$/, "");
const endpoint = `${base}/api/toolkit/mcp`;

/** A fresh demo family (spotter Sam) with a USD shopping agent and its key. Neon only: a second process must
 * never open the dev server's PGlite folder. */
async function setup(): Promise<string> {
  if (!process.env.DATABASE_URL) throw new Error("--setup needs DATABASE_URL (Neon). With local PGlite, make the agent in the app instead.");
  const { getDb } = await import("../src/db");
  const { createHousehold } = await import("../src/core/households");
  const { createSpender } = await import("../src/core/lifecycle");
  const { issueAgentToken } = await import("../src/core/pairing");
  const db = await getDb();
  const hh = await createHousehold(db, { name: "Toolkit demo", spotterName: "Sam", demo: true });
  const id = `agent_tk_${Date.now().toString(36)}`;
  const usd = (amount: number) => ({ amount, currency: "USD" as const });
  await createSpender(db, {
    id,
    householdId: hh.id,
    name: "Shopping agent (PayPal toolkit)",
    kind: "agent",
    spotterName: "Sam",
    allowance: { weekly: usd(40000), askAbove: usd(3000), blockedCategories: ["gift_cards", "crypto", "gambling"], allowedPayees: [], blockedPayees: [] },
  });
  console.log(`Made demo family ${hh.id} with agent ${id} (USD allowance $400 a week, ask above $30).`);
  return issueAgentToken(db, id);
}

/** Minimal MCP over Streamable HTTP: one JSON-RPC POST per call; the answer comes back as JSON or one SSE event. */
let rpcId = 0;
async function mcp(token: string, method: string, params: unknown) {
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
}

const SYSTEM =
  "You are a shopping agent with PayPal's Agent Toolkit tools. Buy what the user asks for, then report back in two short sentences. " +
  "Create the order, then pay it. If a payment can't go through, don't look for another way to pay; tell the user why.";

const TASK =
  "Please buy me the noise cancelling earbuds from this page and pay for them.\n\n" +
  "--- page ---\nSoundDepot\nWF-1000XM5 Noise Cancelling Earbuds, black\nPrice: $119.00, free shipping\nIn stock, ships tomorrow\n--- end ---";

async function main() {
  const token = process.argv.includes("--setup") ? await setup() : process.env.TOOLKIT_AGENT_TOKEN;
  if (!token) throw new Error("Set TOOLKIT_AGENT_TOKEN (an agent key from Spotter) or pass --setup.");

  await mcp(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "toolkit-agent-demo", version: "1" } });
  const offered: string[] = (await mcp(token, "tools/list", {})).tools.map((t: { name: string }) => t.name);

  // PayPal's own definitions, exactly as the toolkit ships them, for the tools Spotter offers.
  const official = new PayPalMCPToolkit({
    accessToken: "not-used-the-agent-never-talks-to-paypal",
    configuration: { actions: { orders: { create: true, get: true, capture: true } }, context: { sandbox: true } },
  }).getTools();
  const tools = official
    .filter((t) => offered.includes(t.method))
    .map((t) => ({ name: t.method, description: t.description.trim(), input_schema: (zodToJsonSchema as (s: unknown) => any)(t.parameters) }));
  console.log(`Spotter offers: ${offered.join(", ")}. Using PayPal's toolkit ${TOOLKIT_VERSION} definitions for: ${tools.map((t) => t.name).join(", ")}`);
  if (process.argv.includes("--dry")) return; // checks the key, the endpoint and the definitions without calling Claude

  const client = new Anthropic({ maxRetries: 1 });
  const messages: Array<{ role: "user" | "assistant"; content: any }> = [{ role: "user", content: TASK }];
  const transcript: Array<Record<string, unknown>> = [{ role: "user", text: TASK }];
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = (await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      tools,
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
          const r = await mcp(token, "tools/call", { name: block.name, arguments: block.input });
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
  const dir = path.resolve(import.meta.dirname, "../../paypal-spotter-submission");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `toolkit-agent-run-${day}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { model: MODEL, effort: "low", toolkit: `@paypal/agent-toolkit@${TOOLKIT_VERSION}`, spotter: endpoint, ran_at: new Date().toISOString(), tools: tools.map((t) => t.name), system: SYSTEM, transcript, usage },
      null,
      2,
    ),
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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
