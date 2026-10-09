import { describe, expect, it } from "vitest";
import { checkRules } from "./rules";
import type { Allowance, PaymentRequest } from "./types";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });

const allowance = (over: Partial<Allowance> = {}): Allowance => ({
  weekly: gbp(5000),
  spentThisWeek: gbp(0),
  askAbove: gbp(2000),
  blockedCategories: ["gift_cards", "crypto", "gambling"],
  allowedPayees: ["Tesco"],
  blockedPayees: ["ShadyShop"],
  ...over,
});

const req = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  id: "p1",
  spenderId: "s1",
  money: gbp(1500),
  payee: { name: "Tesco", isNew: false },
  category: "groceries",
  method: "paypal_order",
  context: "",
  createdAt: "2026-10-09T12:00:00Z",
  ...over,
});

const rules = (r: ReturnType<typeof checkRules>) => r.hits.map((h) => `${h.rule}:${h.outcome}`);

describe("checkRules", () => {
  it("rejects zero, negative and non integer amounts", () => {
    for (const amount of [0, -100, 12.5, Number.NaN]) {
      expect(checkRules(req({ money: gbp(amount) }), allowance()).valid).toBe(false);
    }
  });

  it("blocks a currency that doesn't match the allowance", () => {
    const r = checkRules(req({ money: { amount: 1500, currency: "USD" } }), allowance());
    expect(rules(r)).toContain("currency:block");
  });

  it("blocks going over the remaining weekly allowance", () => {
    const r = checkRules(req({ money: gbp(600) }), allowance({ spentThisWeek: gbp(4500) }));
    expect(rules(r)).toContain("allowance:block");
  });

  it("writes reasons in money, not pence", () => {
    const r = checkRules(req({ money: gbp(600) }), allowance({ spentThisWeek: gbp(4500) }));
    expect(r.hits.find((h) => h.rule === "allowance")!.reason).toBe("Only £5.00 left this week, this payment is £6.00.");
  });

  it("asks above the ask threshold", () => {
    const r = checkRules(req({ money: gbp(2500) }), allowance());
    expect(rules(r)).toContain("threshold:ask");
  });

  it("does not ask exactly at the threshold", () => {
    const r = checkRules(req({ money: gbp(2000) }), allowance());
    expect(rules(r)).not.toContain("threshold:ask");
  });

  it("blocks a blocked category", () => {
    const r = checkRules(req({ category: "gift_cards" }), allowance());
    expect(rules(r)).toContain("category:block");
  });

  it("matches categories loosely so 'gift cards' can't dodge gift_cards", () => {
    for (const category of ["gift cards", "Gift-Cards", " GIFT_CARDS "]) {
      expect(rules(checkRules(req({ category }), allowance()))).toContain("category:block");
    }
  });

  it("ignores invisible characters in payee names", () => {
    const r = checkRules(req({ payee: { name: "Shady​Shop", isNew: false } }), allowance());
    expect(rules(r)).toContain("payee:block");
  });

  it("blocks a blocked payee, case insensitive", () => {
    const r = checkRules(req({ payee: { name: "shadyshop", isNew: false } }), allowance());
    expect(rules(r)).toContain("payee:block");
  });

  it("asks for a new payee unless they are allowlisted", () => {
    expect(rules(checkRules(req({ payee: { name: "NewShop", isNew: true } }), allowance()))).toContain("new_payee:ask");
    expect(rules(checkRules(req({ payee: { name: "Tesco", isNew: true } }), allowance()))).not.toContain("new_payee:ask");
  });

  it("turns a Friends & Family request into protect", () => {
    const r = checkRules(req({ method: "friends_and_family" }), allowance());
    expect(rules(r)).toContain("method:protect");
  });

  it("blocks gift card and crypto payment methods", () => {
    expect(rules(checkRules(req({ method: "gift_card" }), allowance()))).toContain("method:block");
    expect(rules(checkRules(req({ method: "crypto" }), allowance()))).toContain("method:block");
  });

  it("has no hits for a clean request under every limit", () => {
    const r = checkRules(req(), allowance());
    expect(r.valid).toBe(true);
    expect(r.hits).toEqual([]);
  });
});
