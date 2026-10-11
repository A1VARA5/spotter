// The one line "why" for a payment (Activity's Why column, the feed rows, a closed card), ranked by how serious each
// sign is, so a stopped booby trapped shop reads "hides orders for AI agents", not "First time paying GadgetBarn".
// Order: a tripwire pause, then proof made by code in the case file (hidden orders, two faces, card details sent off
// site), then high signs from the check (most serious kind first), the AI being down, the scam advice, medium signs,
// the rules, "First time paying", and last low signs and notes.
import type { Decision } from "./decide";
import { CHANGED_BANK_ADVICE, SCAM_ADVICE } from "./decide";
import type { Flag, FlagKind, Severity } from "./grounding";
import { tripReason, type TripInput } from "./tripped";
import { outcomeLine, settledAs, type SettledInput } from "./settled";

type ProofFinding = { kind?: "prompt_injection" | "cloaking" | "money_offsite"; severity?: "high"; toolName?: string };
export type ReasonInput = { decision: Decision | null | undefined; case_file?: { findings: ProofFinding[] } | null } & Partial<TripInput>;

/** The case file's code made proof, in a few plain words. */
const PROOF = {
  page: "The shop page hides orders for AI agents.",
  tool: "The shop gives AI agents a tool with hidden orders in it.",
  cloaking: "The link shows phones a card form it hides from security scanners.",
  money_offsite: "Card details typed on this page would go to a different site.",
} as const;

const KIND_ORDER: FlagKind[] = ["prompt_injection", "gift_card_or_crypto", "changed_bank_details", "impersonation", "pressure", "friends_and_family", "price", "new_shop", "other"];
const SEVERITY_RANK: Record<Severity, number> = { high: 20, medium: 50, low: 90 };

const PAUSED = /paused by a tripwire/i;
const AI_DOWN = /^The AI check didn.t run/;
const FIRST_TIME = /^First time paying /;
const BACKUP = /backup AI model/i;

function proofLines(c: ReasonInput["case_file"]): string[] {
  const out: string[] = [];
  for (const f of c?.findings ?? []) {
    if (f.severity !== "high" || !f.kind) continue;
    const line = f.kind === "prompt_injection" ? (f.toolName ? PROOF.tool : PROOF.page) : PROOF[f.kind];
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

function rankOf(reason: string, flags: Flag[]): number {
  if (PAUSED.test(reason)) return 0;
  const f = flags.find((x) => x.why === reason);
  if (f) return SEVERITY_RANK[f.severity] + Math.max(0, KIND_ORDER.indexOf(f.kind));
  if (AI_DOWN.test(reason)) return 35;
  if (reason === SCAM_ADVICE || reason === CHANGED_BANK_ADVICE) return 40;
  if (BACKUP.test(reason)) return 95;
  if (FIRST_TIME.test(reason)) return 80;
  return 70; // a rule: over the limit, a blocked category or payee
}

/** Every reason once, strongest first. The case file's proof joins at the top when the check itself didn't see it. */
export function rankedReasons(p: ReasonInput): string[] {
  const d = p.decision;
  const flags = d?.flags ?? [];
  const reasons = [...new Set(d?.reasons ?? [])].map((r, i) => ({ r, rank: rankOf(r, flags), i }));
  const proof = proofLines(p.case_file).map((r, i) => ({ r, rank: 10, i: -100 + i }));
  // A high hidden orders sign from the check already says what the page proof says: the proof line isn't repeated.
  const injectionSaid = flags.some((f) => f.kind === "prompt_injection" && f.severity === "high" && reasons.some((x) => x.r === f.why));
  const extra = proof.filter((x) => !(injectionSaid && (x.r === PROOF.page || x.r === PROOF.tool)));
  // A tripwire that froze the agent and let the hold go outranks everything, even the rule that held it.
  const trip = p.status ? tripReason({ status: p.status, decided_by: p.decided_by, tripwire: p.tripwire }) : null;
  if (trip) extra.unshift({ r: trip, rank: -1, i: -200 });
  return [...extra, ...reasons].sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.r);
}

/** The strongest reason, or null when there is nothing to say. */
export function topReason(p: ReasonInput): string | null {
  return rankedReasons(p)[0] ?? null;
}

// ---------- the why after the decision, in the past tense ----------
// A paid skillet next to "Prices this low are a fake shop tell" reads as if it's still being decided. Reasons code
// writes itself are turned into a past tense clause; anything else (the AI check's own words) keeps its words after
// a "Held:" or "Stopped:" label, so the line never pretends the AI's sentence was rewritten.
const PAST: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^(.+?) is far below what real shops charge \((.+?)\)\. Prices this low are a fake shop tell\.$/, (m) => `${m[1]} was far below what real shops charge (${m[2]})`],
  [/^The shop page hides orders for AI agents\.$/, () => "the shop page hid orders for AI agents"],
  [/^The shop gives AI agents a tool with hidden orders in it\.$/, () => "the shop gave AI agents a tool with hidden orders in it"],
  [/^The link shows phones a card form it hides from security scanners\.$/, () => "the link showed phones a card form it hid from security scanners"],
  [/^Card details typed on this page would go to a different site\.$/, () => "card details typed on that page would have gone to a different site"],
  [/^First time paying (.+)\.$/, (m) => `it was the first time paying ${m[1]}`],
  [/^Over the (.+) limit\.$/, (m) => `it was over the ${m[1]} limit`],
  [/^Set to ask first for every payment, whatever the amount\.$/, () => "it was set to ask first for every payment"],
  [new RegExp(`^${SCAM_ADVICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), () => "it looked like a scam"],
  [new RegExp(`^${CHANGED_BANK_ADVICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), () => "the bank details had changed"],
];

const pastClause = (reason: string): string | null => {
  for (const [re, f] of PAST) {
    const m = re.exec(reason);
    if (m) return f(m);
  }
  return null;
};

export type DecidedInput = ReasonInput & SettledInput;

/**
 * The one line why for a feed or Activity row. While it waits, the strongest reason as it is. Once decided: "Held
 * because ..." / "Stopped because ..." in the past tense, plus who approved a paid one. A tripwire's line is already
 * past tense. null: nothing to say (paid within the rules).
 */
export function decidedReason(p: DecidedInput): string | null {
  const s = settledAs(p);
  if (s === "paid_by_rules" && p.decision?.outcome === "allow") return null;
  const top = topReason(p);
  // Decided with no reason at all: how it ended, in the past tense, never "Within the rules." next to a denial.
  if (s && !top && s !== "failed") return outcomeLine(p);
  if (!s || !top || s === "paused" || s === "failed") return top && oneStop(top);
  const verb = s === "stopped" ? "Stopped" : s === "not_sent" ? "Not sent" : "Held";
  const clause = pastClause(top);
  // The AI's own sentence keeps its words after a short label: "Stopped: It hides text from people ...". A Not me
  // says why it was held in its own words instead, since the person the message named has already answered.
  const why = clause ? `${verb} because ${clause}.` : s === "not_me" ? notMeWhy(p) : `${verb}: ${oneStop(top)}`;
  // Endings where money moved after the hold say so, so "Held because" never sits alone next to a payment.
  if (s === "paid") return `${why} Paid after ${p.decided_by} approved.`;
  if (s === "paying") return `${why} ${p.decided_by && p.decided_by !== "Spotter" ? `${p.decided_by} approved it` : "It was approved"} and PayPal is paying it.`;
  if (s === "paid_anyway") return `${why} PayPal took it anyway.`;
  if (s === "paid_by_rules") return `${why} Paid within the rules.`;
  return why;
}

/** "Held because the message said it was from Tom, and Tom said it wasn't." ("you" when the spotter was the one named). */
function notMeWhy(p: DecidedInput): string {
  const w = p.was_it_you;
  const who = !w ? "someone you know" : w.channel === "alert" ? "you" : w.who;
  return `Held because the message said it was from ${who}, and ${who} said it wasn't.`;
}

/** One full stop at the end, never two: 'new number.".' and 'today..' (an AI sentence, a quote) lose the extra one. */
export function oneStop(line: string): string {
  return line.replace(/\.(["”']?)\.+$/, ".$1");
}
