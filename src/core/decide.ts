// Decision: rules + grounded flags -> allow | ask | protect | block.
// Evidence can only make it stricter. A failed AI check never makes anything safer than the rules say.
import type { Flag } from "./grounding";
import type { RulesResult } from "./types";

export type Outcome = "allow" | "ask" | "protect" | "block";
export type Decision = { outcome: Outcome; reasons: string[]; flags: Flag[] };

const STRICTNESS: Record<Outcome, number> = { allow: 0, ask: 1, protect: 2, block: 3 };
const stricter = (a: Outcome, b: Outcome) => (STRICTNESS[b] > STRICTNESS[a] ? b : a);

function flagOutcome(f: Flag): Outcome {
  if (f.kind === "friends_and_family") return "protect";
  if (f.severity === "high") {
    if (f.kind === "prompt_injection" || f.kind === "impersonation" || f.kind === "gift_card_or_crypto") return "block";
    return "ask";
  }
  return f.severity === "medium" ? "ask" : "allow";
}

export function decide(
  rules: RulesResult,
  ai: { ok: boolean; flags: Flag[] },
  money: { amount: number; askAbove: number },
): Decision {
  if (!rules.valid) return { outcome: "block", reasons: ["The payment amount isn't valid."], flags: [] };

  let outcome: Outcome = "allow";
  // Most serious first: high severity evidence, then the rules, then softer flags.
  const urgent: string[] = [];
  const softer: string[] = [];
  const ruleReasons: string[] = [];
  for (const h of rules.hits) {
    outcome = stricter(outcome, h.outcome);
    ruleReasons.push(h.reason);
  }
  for (const f of ai.flags) {
    const o = flagOutcome(f);
    outcome = stricter(outcome, o);
    if (o !== "allow") (f.severity === "high" ? urgent : softer).push(f.why);
  }
  const reasons = [...urgent, ...ruleReasons, ...softer];
  if (!ai.ok) {
    reasons.push("The AI check didn't run, so only the rules were applied.");
    if (money.amount > money.askAbove) outcome = stricter(outcome, "ask");
  }
  return { outcome, reasons, flags: ai.flags };
}
