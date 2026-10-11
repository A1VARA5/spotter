// A hold Spotter let go because a tripwire froze the agent (it reached for a bait tool, or someone used its decoy key).
// Nobody denied it, so it never reads "Denied": it gets its own outcome words and its strongest reason is the tripwire
// itself (the bait tool and the hidden line it read), not whichever rule happened to hold the payment.
// Pure, so the dashboard, Activity, the case file line and the server agree. Also the agent lab's test agent id.
import { PAUSED_BY } from "./decidedBy";
import type { TripwireCause } from "./tripwire";

/** The tripwire that let this payment go, attached by listPayments (src/core/lifecycle.ts). */
export type PaymentTrip = { id: string; tool: string; at: string; cause: TripwireCause | null };

export type TripInput = { status: string; decided_by?: string | null; tripwire?: PaymentTrip | null };

/** "tripwire" (a bait tool), "decoy" (the planted key was used), or null when a person or a rule decided it. */
export function tripOf(p: TripInput): "tripwire" | "decoy" | null {
  if (p.decided_by !== PAUSED_BY || (p.status !== "voided" && p.status !== "voiding")) return null;
  return p.tripwire?.tool === "decoy_key" ? "decoy" : "tripwire";
}

const OUTCOME = {
  tripwire: { long: "Stopped by a tripwire", explain: "The agent reached for a tool it never needs, so Spotter froze it and PayPal released the hold." },
  decoy: { long: "Stopped by a decoy key", explain: "Someone used the decoy key planted in the agent's settings, so Spotter froze it and PayPal released the hold." },
} as const;

/** The outcome pill and its sentence. Shown in the Stopped colour; null when this wasn't a tripwire stop. */
export function tripOutcome(p: TripInput): { state: "blocked"; short: "Stopped"; long: string; explain: string } | null {
  const kind = tripOf(p);
  return kind ? { state: "blocked", short: "Stopped", ...OUTCOME[kind] } : null;
}

/** Where the line that could have caused it came from, for the tripwire's details. */
export const CAUSE_LABEL: Record<TripwireCause["kind"], string> = {
  hidden_text: "Text hidden from people on the page it read",
  poisoned_tool: "A line in a tool the page offered AI agents",
  flagged_line: "A line Spotter's check flagged as orders for AI agents",
};

const QUOTE_MAX = 160;
const AFTER: Record<TripwireCause["kind"], (payee: string) => string> = {
  hidden_text: (payee) => `after reading a line hidden from people on the ${payee} page`,
  poisoned_tool: (payee) => `after reading a line in a tool the ${payee} page offered AI agents`,
  flagged_line: (payee) => `after reading a line on the ${payee} page that Spotter flagged as orders for AI agents`,
};

/** The strongest reason: the bait tool and the hidden line it read. Null when this wasn't a tripwire stop. */
export function tripReason(p: TripInput): string | null {
  const kind = tripOf(p);
  if (!kind) return null;
  if (kind === "decoy") return "Someone used the decoy key planted in its settings. Nothing legitimate ever sends it.";
  const t = p.tripwire;
  if (!t) return "A tripwire paused the agent, so Spotter let the hold go.";
  const said = `Reached for ${t.tool}, a tool its job never needs`;
  const c = t.cause;
  if (!c?.quote.trim()) return `${said}. Someone may be steering it.`;
  const q = c.quote.trim();
  const quote = q.length > QUOTE_MAX ? `${q.slice(0, QUOTE_MAX - 1)}…` : q;
  return `${said}, ${AFTER[c.kind](c.payee)}: "${quote}"`;
}

// ---------- the agent lab's test agent ----------
// One per family, id `${householdId}_lab` (src/server/agent-lab.ts). Household ids are "hh_" + 12 base64url
// characters, so no real spender ("sp_...") can match. It stays out of People, Watchtower and the Spotter network.
export const LAB_NAME = "Naive test agent";
export const labSpenderId = (householdId: string) => `${householdId}_lab`;
export const isLabSpenderId = (id: string) => /^hh_[\w-]+_lab$/.test(id);
/** SQL: true for rows whose spender (alias s) is not the lab's test agent. */
export const NOT_LAB_SQL = "s.id <> s.household_id || '_lab'";
