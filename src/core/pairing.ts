// Connecting people to Spotter. One pattern for every channel: the person sends a short, single use code
// from the channel being paired (an email to Spotter's inbox, /start in Telegram). Agents get a token instead,
// shown once and stored only as a hash.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "@/db";
import { getSpender, type Spender } from "./lifecycle";
import { disconnectedText, sendWarning, storeWarning, type Warn } from "./switchedoff";

export type Channel = "email" | "telegram" | "discord";
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_HOURS = 24;
const MAX_FAILURES_PER_HOUR = 10;

export async function createPairingCode(db: Db, p: { householdId: string; spenderId: string | null; channel: Channel }): Promise<string> {
  // Older unused codes for the same person and channel stop working, so only the latest one is live.
  await db.query(
    "update pairing_codes set used_at = now() where household_id = $1 and spender_id is not distinct from $2 and channel = $3 and used_at is null",
    [p.householdId, p.spenderId, p.channel],
  );
  const code = "SPOT-" + Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  await db.query(
    "insert into pairing_codes (code, household_id, spender_id, channel, expires_at) values ($1, $2, $3, $4, now() + make_interval(hours => $5))",
    [code, p.householdId, p.spenderId, p.channel, CODE_HOURS],
  );
  return code;
}

/** Finds a SPOT- code anywhere in a piece of text (an email subject or body, a Telegram /start payload). */
export function findCode(text: string): string | null {
  const m = new RegExp(String.raw`\bSPOT-[${CODE_ALPHABET}]{6}\b`, "i").exec(text);
  return m ? m[0].toUpperCase() : null;
}

export async function redeemPairingCode(
  db: Db,
  rawCode: string,
  channel: Channel,
  rawIdentity: string,
  /** Tells another family's spotter when this takes their person's chat or email (core/switchedoff.ts), after the reply. */
  notice?: { warn?: Warn; defer?: (task: () => Promise<void>) => void },
): Promise<{ householdId: string; spender: Spender | null } | null> {
  const identity = `${channel}:${rawIdentity.trim().toLowerCase()}`;
  const value = channel === "email" ? rawIdentity.trim().toLowerCase() : rawIdentity.trim();
  const [{ n }] = (await db.query<{ n: string }>(
    "select count(*)::text as n from pairing_failures where identity = $1 and at > now() - interval '1 hour'",
    [identity],
  )) as [{ n: string }];
  if (Number(n) >= MAX_FAILURES_PER_HOUR) return null;

  const code = rawCode.trim().toUpperCase();
  const rows = await db.query<{ household_id: string; spender_id: string | null }>(
    "update pairing_codes set used_at = now() where code = $1 and channel = $2 and used_at is null and expires_at > now() returning household_id, spender_id",
    [code, channel],
  );
  const hit = rows[0];
  if (!hit) {
    await db.query("insert into pairing_failures (identity) values ($1)", [identity]);
    return null;
  }
  const column = channel === "email" ? "email" : channel === "telegram" ? "telegram_chat_id" : "discord_user_id";
  if (hit.spender_id) {
    // Taken from a person in ANOTHER family: a scammer with their own Spotter account can send a code like this.
    const takenFrom = await db.query<{ id: string; name: string; household_id: string }>(
      `select id, name, household_id from spenders where lower(${column}) = lower($1) and household_id <> $2`,
      [value, hit.household_id],
    );
    // Their spotter's warning is stored BEFORE the move: if it can't be stored, the move doesn't happen either.
    const warnings = takenFrom.map((s) => ({ s, w: { kind: "channel_moved" as const, text: disconnectedText(s.name, channel === "email" ? "email" : "chat") } }));
    const fresh: typeof warnings = [];
    for (const x of warnings) if (await storeWarning(db, x.s.household_id, `moved:${code}:${x.s.id}`, x.w)) fresh.push(x);
    // An address or chat belongs to one person at a time: pairing it here unpairs it anywhere else.
    await db.query(`update spenders set ${column} = null where lower(${column}) = lower($1)`, [value]);
    await db.query(`update spenders set ${column} = $2 where id = $1`, [hit.spender_id, value]);
    for (const x of fresh) await sendWarning(notice ?? {}, x.s.household_id, x.w);
    return { householdId: hit.household_id, spender: await getSpender(db, hit.spender_id) };
  }
  // The spotter's own email is where alerts go, so it lives in its own column (PayPal's email may be a sandbox one).
  const hhColumn = channel === "email" ? "alert_email" : channel === "telegram" ? "telegram_chat_id" : "discord_user_id";
  await db.query(`update households set ${hhColumn} = $2 where id = $1`, [hit.household_id, value]);
  return { householdId: hit.household_id, spender: null };
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const newToken = () => `spt_${randomBytes(32).toString("base64url")}`;

/**
 * A real key, shown once, and a decoy planted next to it in the agent's config (a "backup key" it is told never to
 * use). The decoy never authenticates: any request carrying it means the agent's secrets leaked (core/agent-keys.ts).
 * Making keys switches off the agent's old key and old decoy. Both are stored only as hashes plus the last 4 characters.
 */
export async function issueAgentKeys(db: Db, spenderId: string, opts: { expiresInMinutes?: number } = {}): Promise<{ key: string; decoy: string }> {
  const s = await getSpender(db, spenderId);
  if (!s || s.kind !== "agent") throw new Error("Only AI agents get a token.");
  await db.query("update agent_tokens set revoked_at = now() where spender_id = $1 and revoked_at is null", [spenderId]);
  const key = newToken();
  const decoy = newToken();
  const expires = opts.expiresInMinutes === undefined ? null : new Date(Date.now() + opts.expiresInMinutes * 60_000).toISOString();
  await db.query("insert into agent_tokens (hash, spender_id, label, canary, expires_at) values ($1, $2, $3, false, $4), ($5, $2, $6, true, $4)", [
    hashToken(key),
    spenderId,
    key.slice(-4),
    expires,
    hashToken(decoy),
    decoy.slice(-4),
  ]);
  return { key, decoy };
}

export async function issueAgentToken(db: Db, spenderId: string): Promise<string> {
  return (await issueAgentKeys(db, spenderId)).key;
}

/** True when the agent has a key that still works (making a new one switches it off). */
export async function hasAgentToken(db: Db, spenderId: string): Promise<boolean> {
  const rows = await db.query("select 1 from agent_tokens where spender_id = $1 and revoked_at is null and not canary and (expires_at is null or expires_at > now()) limit 1", [spenderId]);
  return rows.length > 0;
}

export type AgentAuth =
  | { kind: "agent"; spenderId: string; householdId: string; hash: string; label: string | null }
  | { kind: "canary"; spenderId: string; householdId: string; hash: string };

/** Who a bearer key belongs to: a live agent key, a live decoy (canary), or nobody. */
export async function authenticate(db: Db, bearer: string | undefined): Promise<AgentAuth | null> {
  if (!bearer || !/^spt_[A-Za-z0-9_-]{20,100}$/.test(bearer)) return null;
  const hash = hashToken(bearer);
  const rows = await db.query<{ hash: string; spender_id: string; household_id: string; label: string | null; canary: boolean }>(
    `select t.hash, t.spender_id, s.household_id, t.label, t.canary from agent_tokens t join spenders s on s.id = t.spender_id
     where t.hash = $1 and t.revoked_at is null and (t.expires_at is null or t.expires_at > now())`,
    [hash],
  );
  const r = rows[0];
  if (!r || !timingSafeEqual(Buffer.from(r.hash), Buffer.from(hash))) return null;
  if (r.canary) return { kind: "canary", spenderId: r.spender_id, householdId: r.household_id, hash };
  return { kind: "agent", spenderId: r.spender_id, householdId: r.household_id, hash, label: r.label };
}

/** A live, real agent key (never a decoy). */
export async function verifyAgentToken(db: Db, bearer: string | undefined): Promise<{ spenderId: string; householdId: string } | null> {
  const a = await authenticate(db, bearer);
  return a?.kind === "agent" ? { spenderId: a.spenderId, householdId: a.householdId } : null;
}
