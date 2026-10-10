// Shared domain types. Money is always integer minor units (pence / cents).

export type Currency = "GBP" | "USD";
export type Money = { amount: number; currency: Currency };

export type PaymentMethod =
  | "paypal_order"
  | "friends_and_family"
  | "gift_card"
  | "crypto"
  | "bank_transfer"
  | "other";

export type PaymentRequest = {
  id: string;
  spenderId: string;
  money: Money;
  payee: { name: string; id?: string; isNew: boolean };
  category: string;
  method: PaymentMethod;
  /** The product being bought, for the market price check (optional). */
  item?: string;
  /** What the spender saw: the agent's cart and page, or the message Gran got. Untrusted. */
  context: string;
  createdAt: string;
  /** Set when the spotter swapped a held payment for a safer one: the payment this replaced. */
  swappedFrom?: string;
  /** Set when an AI agent paid the safer option Spotter suggested after stopping it (see core/safer.ts). Written by code only. */
  saferOption?: { offer_id: string; reason: string; from_payee: string };
};

export type Allowance = {
  weekly: Money;
  spentThisWeek: Money;
  askAbove: Money;
  blockedCategories: string[];
  allowedPayees: string[];
  blockedPayees: string[];
};

export type RuleOutcome = "ask" | "block" | "protect";
export type RuleHit = { rule: string; outcome: RuleOutcome; reason: string };
export type RulesResult = { valid: boolean; hits: RuleHit[] };

/** "£12.50" style text for reasons shown to people. Core stays free of UI code. */
export function formatMoney(m: Money): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: m.currency }).format(m.amount / 100);
}
