// Rules engine: plain code, no AI. spec.md > The core loop, step 2.
import type { Allowance, PaymentRequest, RuleHit, RulesResult } from "./types";

const BLOCKED_METHODS = new Set(["gift_card", "crypto"]);
const lower = (s: string) => s.trim().toLowerCase();

export function checkRules(req: PaymentRequest, a: Allowance): RulesResult {
  const { amount, currency } = req.money;
  if (!Number.isInteger(amount) || amount <= 0) return { valid: false, hits: [] };

  const hits: RuleHit[] = [];
  const hit = (rule: string, outcome: RuleHit["outcome"], reason: string) => hits.push({ rule, outcome, reason });

  if (currency !== a.weekly.currency) {
    hit("currency", "block", `Paying in ${currency} but the allowance is in ${a.weekly.currency}.`);
  } else {
    const left = a.weekly.amount - a.spentThisWeek.amount;
    if (amount > left) hit("allowance", "block", `Only ${left} left this week, this payment is ${amount}.`);
    if (amount > a.askAbove.amount) hit("threshold", "ask", `Above the "ask me above" limit of ${a.askAbove.amount}.`);
  }

  if (a.blockedCategories.map(lower).includes(lower(req.category))) {
    hit("category", "block", `${req.category} is a blocked category.`);
  }

  const payee = lower(req.payee.name);
  if (a.blockedPayees.map(lower).includes(payee)) {
    hit("payee", "block", `${req.payee.name} is on the blocked list.`);
  } else if (req.payee.isNew && !a.allowedPayees.map(lower).includes(payee)) {
    hit("new_payee", "ask", `First time paying ${req.payee.name}.`);
  }

  if (BLOCKED_METHODS.has(req.method)) {
    hit("method", "block", `Paying by ${req.method.replace("_", " ")} can't be undone and is a classic scam ask.`);
  } else if (req.method === "friends_and_family") {
    hit("method", "protect", "Friends & Family payments have no buyer protection. Pay with a protected PayPal order instead.");
  }

  return { valid: true, hits };
}
