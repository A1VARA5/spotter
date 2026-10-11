// Tripwire tools. Spotter's guarded toolkit server offers the PayPal toolkit tools that make no sense for an agent's
// job (src/core/toolkit-coverage.ts, "bait") with PayPal's own names, descriptions and schemas. They never run and
// never call PayPal. An agent sent to shop that reaches for create_refund or list_transactions is being steered by
// someone else, usually a line it read on a page. So Spotter:
//   1. freezes the agent (nothing it asks for goes through until the spotter clears it with their PIN)
//   2. lets go of its open holds through the normal deny path (PayPal voids each authorisation)
//   3. tells the spotter on their channels, and keeps a record with the tool, the arguments (untrusted text, capped)
//      and the most recent page line that could have caused it
//   4. gives the agent a calm refusal, so it doesn't go looking for another way.
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import { deny, getSpender, type Deps, type Payment } from "./lifecycle";
import { sendWarning } from "./switchedoff";
import { formatMoney, type Currency } from "./types";

export const TRIPWIRE_REPLY = JSON.stringify({
  error: {
    type: "spotter_error",
    message:
      "Spotter can't do that for you. Your job here doesn't include this tool, so your spotter has been told and your payments are paused until they check in. Stop here and tell the user.",
  },
});

const MAX_ARGS = 2000;
const MAX_QUOTE = 400;
const CAUSE_HOURS = 24;

export type TripwireCause = {
  kind: "hidden_text" | "poisoned_tool" | "flagged_line";
  quote: string;
  payee: string;
  paymentId: string;
  toolName?: string;
  at: string;
};

export type Tripwire = {
  id: string;
  spender_id: string;
  agent: string;
  tool: string;
  /** What the agent sent, as JSON text. A stranger may have written it: shown as text, never as markup. */
  args: { text: string; cut: boolean };
  cause: TripwireCause | null;
  voided: number;
  at: string;
  unfrozen_at: string | null;
  /** Without Spotter: what the bait call would have sent, worked out from its own arguments. Calculated only. */
  wouldHaveSent: WouldHaveSent | null;
};

export type WouldHaveSent = { amount: number | null; currency: string | null; text: string };

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;
const CURRENCIES = new Set(["USD", "GBP", "EUR", "CAD", "AUD"]);

/**
 * "Without Spotter": the money PayPal's unguarded toolkit would have tried to move for this bait call, from the call's
 * own arguments. Never calls anything. Junk amounts are ignored. A refund with no amount refunds the whole payment.
 */
export function wouldHaveSent(tool: string, argsJson: string): WouldHaveSent | null {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(argsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    // capped or unreadable arguments: no amount to work out
  }
  const amount = args.amount as { currency_code?: unknown; value?: unknown } | undefined;
  const value = typeof amount?.value === "string" ? amount.value : typeof amount?.value === "number" ? String(amount.value) : "";
  const currency = typeof amount?.currency_code === "string" ? amount.currency_code.toUpperCase() : "";
  if (MONEY.test(value) && CURRENCIES.has(currency)) {
    const minor = Math.round(Number(value) * 100);
    return { amount: minor, currency, text: `${formatMoney({ amount: minor, currency: currency as Currency })} would have left your account` };
  }
  if (tool === "create_refund") return { amount: null, currency: null, text: "The whole payment would have been refunded from your account" };
  return null;
}

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function argsText(args: unknown): { text: string; cut: boolean } {
  let text: string;
  try {
    text = JSON.stringify(args ?? {}, null, 1) ?? "{}";
  } catch {
    text = "(arguments Spotter couldn't read)";
  }
  return text.length > MAX_ARGS ? { text: text.slice(0, MAX_ARGS - 1) + "…", cut: true } : { text, cut: false };
}

type CauseRow = Pick<Payment, "id" | "request" | "ai" | "case_file" | "created_at"> & { read_hidden: string | null };

/** What one payment's own checks saw: a recorded read of the page, KERNEL's hidden text, a poisoned tool, a flagged line. */
function causeIn(p: CauseRow): TripwireCause | null {
  const base = { payee: cap(p.request?.payee?.name ?? "a shop", 120), paymentId: p.id, at: new Date(p.created_at).toISOString() };
  // The page the agent itself read, recorded where it was read (the agent lab feeds its test agent the GadgetBarn page).
  if (p.read_hidden?.trim()) return { kind: "hidden_text", quote: cap(p.read_hidden.trim(), MAX_QUOTE), ...base };
  const hidden = p.case_file?.page?.seen?.hidden?.find((h) => h.instruction && h.text?.trim());
  if (hidden) return { kind: "hidden_text", quote: cap(hidden.text, MAX_QUOTE), ...base };
  const tools = p.case_file?.page?.tools;
  const poisoned = tools && tools.checked ? tools.tools.find((t) => t.poisoned?.quote?.trim()) : undefined;
  if (poisoned?.poisoned) return { kind: "poisoned_tool", quote: cap(poisoned.poisoned.quote, MAX_QUOTE), toolName: cap(poisoned.name, 80), ...base };
  // A flag with no quote ("the content tried to give the agent instructions") has no line to show.
  const flag = p.ai?.flags?.find((f) => f.kind === "prompt_injection" && f.quote?.trim());
  if (flag) return { kind: "flagged_line", quote: cap(flag.quote, MAX_QUOTE), ...base };
  return null;
}

const ROWS = `select p.id, p.request, p.ai, p.case_file, p.created_at,
  (select e.data->>'hidden' from events e where e.payment_id = p.id and e.type = 'agent_read' order by e.at desc limit 1) as read_hidden
  from payments p`;

/**
 * The most recent line written to steer an AI, from the day before `before` (default now): first on a page this
 * agent's own payments were checked against (a recorded read of the page, KERNEL's hidden text, a poisoned tool, a
 * line the AI check flagged), then on the same shop's page as KERNEL saw it for someone else in the family. Never
 * another family's. Null when there is none. It may not be the cause, so it is shown as "could have caused it".
 */
export async function latestCause(db: Db, agentId: string, opts: { before?: Date } = {}): Promise<TripwireCause | null> {
  const before = (opts.before ?? new Date()).toISOString();
  const own = await db.query<CauseRow>(
    `${ROWS} where p.spender_id = $1 and p.created_at <= $3::timestamptz and p.created_at > $3::timestamptz - make_interval(hours => $2)
     order by p.created_at desc limit 10`,
    [agentId, CAUSE_HOURS, before],
  );
  for (const p of own) {
    const c = causeIn(p);
    if (c) return c;
  }
  // The shops this agent was paying, as KERNEL saw them for anyone else in the same family that day.
  const payees = [...new Set(own.map((p) => (p.request?.payee?.name ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!payees.length) return null;
  const family = await db.query<CauseRow>(
    `${ROWS} join spenders s on s.id = p.spender_id
     where s.household_id = (select household_id from spenders where id = $1) and p.spender_id <> $1
       and lower(trim(p.request->'payee'->>'name')) = any($4::text[]) and p.case_file is not null
       and p.created_at <= $3::timestamptz and p.created_at > $3::timestamptz - make_interval(hours => $2)
     order by p.created_at desc limit 10`,
    [agentId, CAUSE_HOURS, before, payees],
  );
  for (const p of family) {
    const hidden = p.case_file?.page?.seen?.hidden?.find((h) => h.instruction && h.text?.trim());
    if (hidden) return { kind: "hidden_text", quote: cap(hidden.text, MAX_QUOTE), payee: cap(p.request?.payee?.name ?? "a shop", 120), paymentId: p.id, at: new Date(p.created_at).toISOString() };
  }
  return null;
}

export const hijackText = (agent: string, tool: string, voided: number) =>
  `${agent} tried to use the PayPal tool ${tool}, which has nothing to do with its job. Someone may be steering it. ` +
  `Spotter paused it${voided ? ` and let go of ${voided === 1 ? "its held payment" : `its ${voided} held payments`}` : ""}. ` +
  `Nothing was sent to PayPal. Open Spotter to see what it asked for, then unpause it with your PIN when you're happy.`;

/** The agent reached for a bait tool. Never calls the tool; only ever releases money (voids holds). */
export async function springTripwire(deps: Deps, agentId: string, tool: string, args: unknown): Promise<{ id: string; voided: number; reply: string }> {
  const { db } = deps;
  const spender = await getSpender(db, agentId);
  if (!spender) {
    console.warn(`[spotter] bait tool ${tool} called by agent ${agentId}, which no longer exists: nothing to pause`);
    return { id: "", voided: 0, reply: TRIPWIRE_REPLY };
  }
  const id = `trip_${randomBytes(8).toString("hex")}`;
  const cause = await latestCause(db, agentId).catch((e) => {
    console.error(`[spotter] tripwire ${id}: couldn't look up what the agent last read:`, e instanceof Error ? e.message : e);
    return null;
  });
  // Frozen first, so nothing it asks for in the meantime can go through.
  await db.query("update spenders set frozen_at = coalesce(frozen_at, now()) where id = $1", [agentId]);
  await db.query("insert into tripwires (id, household_id, spender_id, tool, args, cause) values ($1, $2, $3, $4, $5, $6)", [
    id,
    spender.household_id,
    agentId,
    tool.slice(0, 80),
    JSON.stringify(argsText(args)),
    cause ? JSON.stringify(cause) : null,
  ]);
  console.warn(`[spotter] tripwire ${id}: agent ${agentId} called bait tool ${tool}`);

  const open = await db.query<{ id: string }>("select id from payments where spender_id = $1 and status = 'needs_approval'", [agentId]);
  let voided = 0;
  for (const p of open) {
    try {
      const after = await deny(deps, p.id, "Spotter (the agent was paused)");
      if (after.status === "voided") voided++;
      else console.error(`[spotter] tripwire ${id}: hold ${p.id} ended ${after.status}, not voided`);
    } catch (e) {
      console.error(`[spotter] tripwire ${id}: couldn't let go of hold ${p.id}:`, e instanceof Error ? e.message : e);
    }
  }
  await db.query("update tripwires set voided = $2 where id = $1", [id, voided]);
  // Channels only: the tripwire row is the copy in the app (src/ui/AgentHolds.tsx), so it never crowds out other warnings.
  await sendWarning(deps, spender.household_id, { kind: "agent_hijacked", text: hijackText(spender.name, tool, voided) });
  return { id, voided, reply: TRIPWIRE_REPLY };
}

/** The spotter (PIN checked by the caller) clears a paused agent. False if it isn't theirs or wasn't paused. */
export async function unfreeze(db: Db, householdId: string, agentId: string): Promise<boolean> {
  const rows = await db.query("update spenders set frozen_at = null where id = $1 and household_id = $2 and frozen_at is not null returning id", [agentId, householdId]);
  if (!rows.length) return false;
  await db.query("update tripwires set unfrozen_at = now() where spender_id = $1 and unfrozen_at is null", [agentId]);
  return true;
}

export async function listTripwires(db: Db, householdId: string, limit = 20): Promise<Tripwire[]> {
  const rows = await db.query<Omit<Tripwire, "at" | "unfrozen_at" | "wouldHaveSent"> & { at: string | Date; unfrozen_at: string | Date | null }>(
    `select t.id, t.spender_id, s.name as agent, t.tool, t.args, t.cause, t.voided, t.at, t.unfrozen_at
     from tripwires t join spenders s on s.id = t.spender_id where t.household_id = $1 order by t.at desc limit $2`,
    [householdId, limit],
  );
  const out: Tripwire[] = [];
  for (const r of rows) {
    // KERNEL's look at the shop often finishes after the agent reached for the bait (the case file takes a few
    // seconds), so a tripwire with no cause looks again, up to the moment it sprang, and keeps what it finds.
    const cause = r.cause ?? (await causeLater(db, r.id, r.spender_id, new Date(r.at)));
    out.push({
      ...r,
      cause,
      at: new Date(r.at).toISOString(),
      unfrozen_at: r.unfrozen_at ? new Date(r.unfrozen_at).toISOString() : null,
      wouldHaveSent: r.args?.cut ? null : wouldHaveSent(r.tool, r.args?.text ?? "{}"),
    });
  }
  return out;
}

/** The cause of a tripwire that had none when it sprang, saved once found. A failed lookup just shows no cause. */
async function causeLater(db: Db, id: string, agentId: string, at: Date): Promise<TripwireCause | null> {
  let cause: TripwireCause | null;
  try {
    cause = await latestCause(db, agentId, { before: at });
  } catch (e) {
    console.error(`[spotter] tripwire ${id}: looking again for what the agent read failed:`, e instanceof Error ? e.message : e);
    return null;
  }
  // A failed save only means looking again next time; the cause found is still shown.
  if (cause) {
    await db
      .query("update tripwires set cause = $2 where id = $1 and cause is null", [id, JSON.stringify(cause)])
      .catch((e) => console.error(`[spotter] tripwire ${id}: couldn't save the cause it found:`, e instanceof Error ? e.message : e));
  }
  return cause;
}
