// In front of both agent MCP routes (/api/mcp and /api/toolkit/mcp): the decoy key check, the daily rate limit, and the
// per key tool call log. The MCP servers themselves only ever see a live, real key that still has calls left today.
import type { Deps } from "@/core/lifecycle";
import { authenticate, type AgentAuth } from "@/core/pairing";
import { labelOf, LIMITS, logCall, outcomeOf, overLimit, springCanary } from "@/core/agent-keys";
import type { Db } from "@/db";

type AgentKey = Extract<AgentAuth, { kind: "agent" }>;
type Ctx = { http?: { authInfo?: { extra?: Record<string, unknown> } } };

const bearerOf = (req: Request) => req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];

/** withMcpAuth's verify function: only a live, real agent key, carried to the tools as extra.key. */
export async function agentAuthInfo(db: Db, bearer: string | undefined) {
  const a = await authenticate(db, bearer);
  return a?.kind === "agent" ? { token: bearer!, clientId: "spotter-agent", scopes: ["payments:request"], extra: { spenderId: a.spenderId, key: a } } : undefined;
}

/** The verified key for this tool call. withMcpAuth guarantees it is there. */
export function keyOf(ctx: Ctx): AgentKey {
  const k = ctx.http?.authInfo?.extra?.key as AgentKey | undefined;
  if (!k || typeof k.spenderId !== "string") throw new Error("Missing agent identity.");
  return k;
}

/** The key's public label for PayPal's custom_id (core/agent-keys.ts). */
export const keyLabelOf = (ctx: Ctx) => labelOf(keyOf(ctx).label);

/** Runs a tool and logs it against the key. A logging hiccup never changes the agent's answer, but is loud. */
export async function logged(db: Db, ctx: Ctx, tool: string, args: unknown, run: () => Promise<string>, outcome: (reply: string) => string = outcomeOf): Promise<string> {
  const key = keyOf(ctx);
  let reply: string;
  try {
    reply = await run();
  } catch (e) {
    await logCall(db, key, tool, "error", args).catch((err) => console.error(`[spotter] couldn't log ${tool} for ${key.spenderId}:`, err instanceof Error ? err.message : err));
    throw e;
  }
  await logCall(db, key, tool, outcome(reply), args).catch((err) => console.error(`[spotter] couldn't log ${tool} for ${key.spenderId}:`, err instanceof Error ? err.message : err));
  return reply;
}

const unauthorised = () =>
  Response.json({ error: "invalid_token", error_description: "No valid authorization provided" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } });

/**
 * Wraps an MCP route. The decoy key gets the same calm 401 as any bad key (it must not learn it was a trap), after
 * Spotter froze the agent and burned its keys. A key over today's limit gets a 429 with a plain sentence.
 */
export function guardAgentRoute(getDeps: () => Promise<Deps>, inner: (req: Request) => Promise<Response> | Response, limits = LIMITS) {
  return async (req: Request): Promise<Response> => {
    const deps = await getDeps();
    const hit = await authenticate(deps.db, bearerOf(req));
    if (hit?.kind === "canary") {
      try {
        await springCanary(deps, hit);
      } catch (e) {
        console.error(`[spotter] decoy key for ${hit.spenderId} was used, but freezing it failed:`, e instanceof Error ? e.message : e);
      }
      return unauthorised();
    }
    if (hit?.kind === "agent") {
      const limited = await overLimit(deps.db, hit.hash, limits);
      if (limited) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: limited } }, { status: 429 });
    }
    return inner(req);
  };
}
