// One turn of Watchtower's AI chat: Studio's agents POST an AgLlmRequest, Claude answers on the server
// (the key never reaches the browser), and Studio runs any tools it asked for in the page.
// Each turn counts against a daily cap per family and overall, so a busy demo can't run up the bill.
import Anthropic from "@anthropic-ai/sdk";
import type { AgLlmRequest } from "ag-studio";
import type { Db } from "@/db";
import { fromClaude, toClaude, type ClaudeTurn } from "./claude";

export const WATCHTOWER_MODEL = "claude-opus-5-5";
const MAX_INPUT_ITEMS = 400;
const MAX_TOOLS = 60;

export type CallModel = (turn: ClaudeTurn, signal?: AbortSignal) => Promise<Anthropic.Message>;

export const defaultCallModel: CallModel = async (turn, signal) => {
  // One try inside the route's 60 s limit, so a slow turn ends in our catch (logged) rather than a platform 504.
  const client = new Anthropic({ maxRetries: 0, timeout: 50_000 });
  const tools = turn.tools.map((t, i) => (i === turn.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t));
  return client.messages.create(
    {
      model: WATCHTOWER_MODEL,
      max_tokens: 8000,
      system: [{ type: "text", text: turn.system || "You help a family read their payments dashboard.", cache_control: { type: "ephemeral" } }],
      messages: turn.messages,
      ...(tools.length ? { tools, tool_choice: turn.tool_choice } : {}),
      output_config: turn.output_config,
    },
    { signal },
  );
};

function isAgRequest(v: unknown): v is AgLlmRequest {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.input) && r.input.length <= MAX_INPUT_ITEMS && (r.tools === undefined || (Array.isArray(r.tools) && r.tools.length <= MAX_TOOLS));
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** A daily cap from the environment, or the fallback when it's unset or not a number. */
export function cap(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[spotter] ${name}=${raw} isn't a number; using ${fallback}`);
    return fallback;
  }
  return n;
}

export function makeLlmTurn(opts: { db: Db; callModel?: CallModel; perHousehold?: number; overall?: number }) {
  const { db, callModel = defaultCallModel } = opts;
  const perHousehold = opts.perHousehold ?? cap("WATCHTOWER_TURNS_PER_FAMILY", 60);
  const overall = opts.overall ?? cap("WATCHTOWER_TURNS_PER_DAY", 600);
  return async (householdId: string, body: unknown, signal?: AbortSignal): Promise<Response> => {
    const request = (body as { request?: unknown } | null)?.request;
    if (!isAgRequest(request)) return json({ error: "That wasn't a request the assistant understands." }, 400);
    let turn: ClaudeTurn;
    try {
      turn = toClaude(request);
    } catch (e) {
      console.warn("[spotter] watchtower bad history:", e instanceof Error ? e.message : e);
      return json({ error: "That conversation got muddled. Start a new chat and ask again." }, 400);
    }

    // Take a slot only when there is one, in one statement, so refused or racing requests can't overfill it.
    const [mine] = await db.query<{ n: string }>("select count(*)::text as n from llm_turns where household_id = $1 and at > now() - interval '1 day'", [householdId]);
    if (Number(mine?.n ?? 0) >= perHousehold) return json({ error: "Watchtower's assistant has done all it can for your family today. Try again tomorrow." }, 429);
    const took = await db.query(
      `insert into llm_turns (household_id) select $1
       where (select count(*) from llm_turns where at > now() - interval '1 day') < $2
         and (select count(*) from llm_turns where household_id = $1 and at > now() - interval '1 day') < $3
       returning 1`,
      [householdId, overall, perHousehold],
    );
    if (!took.length) return json({ error: "Watchtower's assistant is resting for today. Try again tomorrow." }, 429);

    let msg: Anthropic.Message;
    try {
      msg = await callModel(turn, signal);
    } catch (e) {
      console.error(`[spotter] watchtower turn failed for ${householdId}:`, e instanceof Error ? e.message : e);
      return json({ error: "The assistant couldn't answer just now. Try again in a minute." }, 502);
    }
    const u = msg.usage;
    console.info(`[spotter] watchtower turn ${householdId}: in ${u.input_tokens} (cache read ${u.cache_read_input_tokens ?? 0}, write ${u.cache_creation_input_tokens ?? 0}) out ${u.output_tokens}`);
    return json({ response: fromClaude(msg) });
  };
}
