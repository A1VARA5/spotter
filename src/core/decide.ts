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
    // Impersonation holds instead of blocking: the ask might really be from family, and a hold gives the
    // spotter time to ring them. Injection and gift cards or crypto are never right, so they block.
    if (f.kind === "prompt_injection" || f.kind === "gift_card_or_crypto") return "block";
    return "ask";
  }
  return f.severity === "medium" ? "ask" : "allow";
}

/** Said once, first, whenever the payee's bank details changed: the classic supplier invoice fraud. */
export const CHANGED_BANK_ADVICE =
  "The bank details changed. Don't pay by bank transfer or Friends and Family: pay with a protected PayPal payment or invoice, and ring the supplier on a number you already have, not one from the email.";

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
  // Changed bank details always wait for a person, whatever severity the check gave them.
  const bankChanged = ai.flags.some((f) => f.kind === "changed_bank_details" && f.severity !== "low");
  if (bankChanged) outcome = stricter(outcome, "ask");
  const reasons = [...(bankChanged ? [CHANGED_BANK_ADVICE] : []), ...urgent, ...ruleReasons, ...softer];
  if (!ai.ok) {
    // Fail closed: without the check, nothing is paid automatically.
    reasons.unshift("The AI check didn't run, so this needs your yes.");
    outcome = stricter(outcome, "ask");
  }
  return { outcome, reasons, flags: ai.flags };
}
