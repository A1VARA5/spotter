// The life of an agent key after it is made: a daily rate limit on the MCP routes, a log of every tool call, the key
// card the spotter sees (label, job, allowance left, status, last calls), "Switch off now", and the canary: a decoy key
// planted next to the real one. Nothing legitimate ever sends the decoy, so its use means the agent leaked its secrets.
import type { Db } from "@/db";
import { deny, getSpender, PAUSED_BY, weekSpend, type Deps } from "./lifecycle";
import type { AgentAuth } from "./pairing";
import { sendWarning } from "./switchedoff";
import type { Money } from "./types";

/** The key's public label for PayPal's custom_id: the prefix and the last 4 characters, nothing more of the secret. */
export const keyLabel = (token: string) => `spt-${token.slice(-4)}`;
/** The same label from what is stored (the last 4 characters). */
export const labelOf = (last4: string | null | undefined) => (last4 ? `spt-${last4}` : undefined);
const shown = (last4: string | null | undefined) => (last4 ? `spt_…${last4}` : "spt_…");

export const LIMITS = {
  perKey: Number(process.env.SPOTTER_KEY_DAILY_CALLS ?? 100),
  global: Number(process.env.SPOTTER_MCP_DAILY_CALLS ?? 2000),
};

/** A plain sentence when this key (or every key together) used up today's tool calls, else null. */
export async function overLimit(db: Db, hash: string, limits = LIMITS): Promise<string | null> {
  const [row] = await db.query<{ mine: string; total: string }>(
    `select count(*) filter (where token_hash = $1)::text as mine, count(*)::text as total
     from agent_calls where at > now() - interval '1 day'`,
    [hash],
  );
  if (Number(row?.mine ?? 0) >= limits.perKey) return `This agent key has made ${limits.perKey} tool calls today, its daily limit. It works again within 24 hours. Nothing was paid.`;
  if (Number(row?.total ?? 0) >= limits.global) return "Spotter's agent tools have hit today's limit for everyone. They work again within 24 hours. Nothing was paid.";
  return null;
}

const MAX_ARGS = 300;

function argsText(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args ?? {}) ?? "{}";
  } catch {
    text = "(arguments Spotter couldn't read)";
  }
  return text.length > MAX_ARGS ? `${text.slice(0, MAX_ARGS)}…` : text;
}

/** One tool call, logged as plain text (a stranger may have written the arguments: never rendered as markup). */
export async function logCall(db: Db, a: Extract<AgentAuth, { kind: "agent" }>, tool: string, outcome: string, args: unknown): Promise<void> {
  await db.query("insert into agent_calls (token_hash, spender_id, household_id, tool, outcome, args) values ($1, $2, $3, $4, $5, $6)", [
    a.hash,
    a.spenderId,
    a.householdId,
    tool.slice(0, 80),
    outcome.slice(0, 40),
    argsText(args),
  ]);
  await db.query("update agent_tokens set last_used_at = now() where hash = $1", [a.hash]);
}

/** What a tool's answer says happened, in one word for the log: a PayPal style status, an error, or ok. */
export function outcomeOf(reply: string): string {
  try {
    const j = JSON.parse(reply) as { status?: unknown; error?: { type?: unknown } };
    if (j?.error) return j.error.type === "spotter_error" ? "refused" : "error";
    if (typeof j?.status === "string") return j.status.slice(0, 40);
  } catch {
    // Spotter's own tools answer in plain text.
  }
  return "ok";
}

export const leakText = (agent: string, voided: number) =>
  `${agent} leaked its key: someone used the decoy key Spotter planted in its config, which the agent was told never to use. ` +
  `Spotter switched off both keys and paused ${agent}${voided ? ` and let go of ${voided === 1 ? "its held payment" : `its ${voided} held payments`}` : ""}. ` +
  `Nothing was paid. Make a new key on ${agent}'s page once you know how it leaked.`;

/** The decoy was used. Freeze the agent, burn every key it has, let go of its holds, record it and alert the spotter. */
export async function springCanary(deps: Deps, hit: Extract<AgentAuth, { kind: "canary" }>): Promise<void> {
  const { db } = deps;
  // Freeze and record BEFORE burning: if either fails, the decoy still works, so its next use tries the whole thing
  // again. The record's id comes from the decoy, so a retry or two requests at once write it only once.
  await db.query("update spenders set frozen_at = coalesce(frozen_at, now()) where id = $1", [hit.spenderId]);
  const id = `trip_decoy_${hit.hash.slice(0, 20)}`;
  const note = { text: "The decoy key planted in this agent's config was sent to Spotter. Nothing legitimate ever sends it.", cut: false };
  await db.query("insert into tripwires (id, household_id, spender_id, tool, args, cause, voided) values ($1, $2, $3, 'decoy_key', $4, null, 0) on conflict (id) do nothing", [
    id,
    hit.householdId,
    hit.spenderId,
    JSON.stringify(note),
  ]);
  // Then burn: one conditional update, so only one request goes on to let go of holds and alert.
  const burned = await db.query("update agent_tokens set revoked_at = now() where spender_id = $1 and revoked_at is null returning hash", [hit.spenderId]);
  if (!burned.length) return;
  console.warn(`[spotter] decoy key used for agent ${hit.spenderId}: both keys burned, agent paused`);
  const spender = await getSpender(db, hit.spenderId);
  const open = await db.query<{ id: string }>("select id from payments where spender_id = $1 and status = 'needs_approval'", [hit.spenderId]);
  let voided = 0;
  for (const p of open) {
    try {
      const after = await deny(deps, p.id, PAUSED_BY);
      if (after.status === "voided") voided++;
      else console.error(`[spotter] decoy key: hold ${p.id} ended ${after.status}, not voided (reconcile keeps asking PayPal)`);
    } catch (e) {
      console.error(`[spotter] decoy key: couldn't let go of hold ${p.id}:`, e instanceof Error ? e.message : e);
    }
  }
  await db.query("update tripwires set voided = $2 where id = $1", [id, voided]);
  await sendWarning(deps, hit.householdId, { kind: "agent_hijacked", text: leakText(spender?.name ?? "Your agent", voided) });
}

/** "Switch off now": the agent's keys (and decoy) stop working, and no new key is made. Only the spotter's own agent. */
export async function switchOff(db: Db, householdId: string, spenderId: string): Promise<boolean> {
  const rows = await db.query(
    `update agent_tokens t set revoked_at = now() from spenders s
     where t.spender_id = s.id and s.id = $1 and s.household_id = $2 and t.revoked_at is null returning t.hash`,
    [spenderId, householdId],
  );
  return rows.length > 0;
}

export type KeyCall = { tool: string; outcome: string; args: string; at: string };
export type KeyCardView = {
  label: string;
  job: string;
  allowanceLeft: Money;
  status: "live" | "frozen" | "switched_off" | "none";
  /** The key itself still works (a frozen agent can have a live key, or one burned by the decoy). */
  keyLive: boolean;
  lastUsedAt: string | null;
  calls: KeyCall[];
  /** The newest agent order and the custom_id Spotter sent PayPal for it (the route may confirm it from PayPal). */
  order: { paypalOrderId: string; customId: string } | null;
};

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

export async function keyCard(db: Db, householdId: string, spenderId: string): Promise<KeyCardView | null> {
  const spender = await getSpender(db, spenderId);
  if (!spender || spender.household_id !== householdId || spender.kind !== "agent") return null;
  const [key] = await db.query<{ hash: string; label: string | null; revoked_at: string | Date | null; expires_at: string | Date | null; last_used_at: string | Date | null }>(
    "select hash, label, revoked_at, expires_at, last_used_at from agent_tokens where spender_id = $1 and not canary order by created_at desc limit 1",
    [spenderId],
  );
  const live = !!key && !key.revoked_at && (!key.expires_at || new Date(key.expires_at).getTime() > Date.now());
  const status = spender.frozen_at ? "frozen" : live ? "live" : key ? "switched_off" : "none";
  const calls = key
    ? (await db.query<{ tool: string; outcome: string; args: string; at: string | Date }>("select tool, outcome, args, at from agent_calls where token_hash = $1 order by id desc limit 5", [key.hash])).map(
        (c) => ({ ...c, at: iso(c.at)! }),
      )
    : [];
  const { weekly } = spender.allowance;
  const spent = await weekSpend(db, spenderId, weekly.currency);
  const [order] = await db.query<{ paypal_order_id: string; paypal_custom_id: string }>(
    "select paypal_order_id, paypal_custom_id from payments where spender_id = $1 and paypal_custom_id is not null and paypal_order_id is not null order by created_at desc limit 1",
    [spenderId],
  );
  return {
    label: shown(key?.label),
    job: spender.agent_job ?? "shopping",
    allowanceLeft: { amount: Math.max(0, weekly.amount - spent), currency: weekly.currency },
    status,
    keyLive: live,
    lastUsedAt: iso(key?.last_used_at ?? null),
    calls,
    order: order ? { paypalOrderId: order.paypal_order_id, customId: order.paypal_custom_id } : null,
  };
}
