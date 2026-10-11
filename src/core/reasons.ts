// The one line "why" for a payment (Activity's Why column, the feed rows, a closed card), ranked by how serious each
// sign is, so a stopped booby trapped shop reads "hides orders for AI agents", not "First time paying GadgetBarn".
// Order: a tripwire pause, then proof made by code in the case file (hidden orders, two faces, card details sent off
// site), then high signs from the check (most serious kind first), the AI being down, the scam advice, medium signs,
// the rules, "First time paying", and last low signs and notes.
import type { Decision } from "./decide";
import { CHANGED_BANK_ADVICE, SCAM_ADVICE } from "./decide";
import type { Flag, FlagKind, Severity } from "./grounding";

type ProofFinding = { kind?: "prompt_injection" | "cloaking" | "money_offsite"; severity?: "high"; toolName?: string };
export type ReasonInput = { decision: Decision | null | undefined; case_file?: { findings: ProofFinding[] } | null };

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
  return [...extra, ...reasons].sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.r);
}

/** The strongest reason, or null when there is nothing to say. */
export function topReason(p: ReasonInput): string | null {
  return rankedReasons(p)[0] ?? null;
}
