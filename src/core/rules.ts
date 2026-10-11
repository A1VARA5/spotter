// Rules engine: plain code, no AI. spec.md > The core loop, step 2.
import { formatMoney, type Allowance, type PaymentRequest, type RuleHit, type RulesResult } from "./types";

const BLOCKED_METHODS = new Set(["gift_card", "crypto"]);
const INVISIBLE = /[​-‍⁠﻿‪-‮⁦-⁩]/g;
/** Names compare without case, invisible characters or surrounding space. */
export const normName = (s: string) => s.replace(INVISIBLE, "").trim().toLowerCase();
/** "Gift-Cards", "gift cards" and "gift_cards" are the same category. */
export const normCategory = (s: string) => normName(s).replace(/[\s-]+/g, "_");
const lower = normName;

export function checkRules(req: PaymentRequest, a: Allowance): RulesResult {
  const { amount, currency } = req.money;
  if (!Number.isInteger(amount) || amount <= 0) return { valid: false, hits: [] };

  const hits: RuleHit[] = [];
  const hit = (rule: string, outcome: RuleHit["outcome"], reason: string) => hits.push({ rule, outcome, reason });

  if (currency !== a.weekly.currency) {
    hit("currency", "block", `Paying in ${currency} but the allowance is in ${a.weekly.currency}.`);
  } else {
    const left = a.weekly.amount - a.spentThisWeek.amount;
    if (amount > left) {
      hit("allowance", "block", `Only ${formatMoney({ amount: Math.max(0, left), currency })} left this week, this payment is ${formatMoney(req.money)}.`);
    }
    // A limit of zero means "ask about everything": say that, not "over the £0.00 limit".
    if (amount > a.askAbove.amount)
      hit("threshold", "ask", a.askAbove.amount <= 0 ? "Set to ask first for every payment, whatever the amount." : `Over the ${formatMoney(a.askAbove)} "ask me first" limit.`);
  }

  if (a.blockedCategories.map(normCategory).includes(normCategory(req.category))) {
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
  } else if (req.method === "bank_transfer") {
    hit("method", "protect", "A bank transfer to someone new is hard to get back if it's a scam. Spotter only pays through PayPal, where there's buyer protection.");
  }

  return { valid: true, hits };
}
