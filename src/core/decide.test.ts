import { describe, expect, it } from "vitest";
import { decide, SCAM_ADVICE } from "./decide";
import type { Flag, FlagKind, Severity } from "./grounding";
import type { RuleHit, RulesResult } from "./types";

const flag = (kind: FlagKind, severity: Severity): Flag => ({ kind, severity, quote: "q", why: "w" });
const hit = (rule: string, outcome: RuleHit["outcome"]): RuleHit => ({ rule, outcome, reason: rule });
const rules = (...hits: RuleHit[]): RulesResult => ({ valid: true, hits });
const ai = (flags: Flag[] = [], ok = true) => ({ ok, flags });
const big = { amount: 5000, askAbove: 2000 };
const small = { amount: 500, askAbove: 2000 };

describe("decide", () => {
  it("blocks an invalid request", () => {
    expect(decide({ valid: false, hits: [] }, ai(), small).outcome).toBe("block");
  });

  it("allows a clean small request", () => {
    expect(decide(rules(), ai(), small).outcome).toBe("allow");
  });

  it("blocks on any rule block", () => {
    expect(decide(rules(hit("allowance", "block")), ai(), small).outcome).toBe("block");
  });

  it("leads with hidden instructions even when a high price flag came first", () => {
    const price: Flag = { kind: "price", severity: "high", quote: "", why: "Far below real shops." };
    const injection: Flag = { kind: "prompt_injection", severity: "high", quote: "q", why: "Hidden orders for AI." };
    const d = decide(rules(), ai([price, injection]), small);
    expect(d.reasons).toEqual(["Hidden orders for AI.", "Far below real shops."]);
  });

  it("blocks on a high prompt injection flag", () => {
    expect(decide(rules(), ai([flag("prompt_injection", "high")]), small).outcome).toBe("block");
  });

  it("holds on high impersonation: it might really be family, so the spotter checks before it's paid", () => {
    expect(decide(rules(), ai([flag("impersonation", "high")]), small).outcome).toBe("ask");
  });

  it("protects on a Friends & Family rule or flag", () => {
    expect(decide(rules(hit("method", "protect")), ai(), small).outcome).toBe("protect");
    expect(decide(rules(), ai([flag("friends_and_family", "high")]), small).outcome).toBe("protect");
  });

  it("asks on an ask rule or a medium flag", () => {
    expect(decide(rules(hit("threshold", "ask")), ai(), small).outcome).toBe("ask");
    expect(decide(rules(), ai([flag("pressure", "medium")]), small).outcome).toBe("ask");
  });

  it("ignores low flags on their own", () => {
    expect(decide(rules(), ai([flag("price", "low")]), small).outcome).toBe("allow");
  });

  it("asks when the AI check failed and the amount is over the ask limit", () => {
    expect(decide(rules(), ai([], false), big).outcome).toBe("ask");
  });

  it("fails closed: a failed AI check asks the spotter even for a small clean request", () => {
    const d = decide(rules(), ai([], false), small);
    expect(d.outcome).toBe("ask");
    expect(d.reasons.join(" ")).toMatch(/AI check didn't run/);
  });

  it("never lets flags weaken a rule block (every combination)", () => {
    const kinds: FlagKind[] = ["pressure", "impersonation", "friends_and_family", "gift_card_or_crypto", "prompt_injection", "price", "new_shop", "changed_bank_details", "other"];
    const sev: Severity[] = ["low", "medium", "high"];
    for (const k of kinds) for (const s of sev) for (const ok of [true, false]) {
      expect(decide(rules(hit("category", "block")), ai([flag(k, s)], ok), small).outcome).toBe("block");
    }
  });

  it("ranks block over protect over ask", () => {
    expect(decide(rules(hit("method", "protect"), hit("threshold", "ask")), ai(), small).outcome).toBe("protect");
    expect(decide(rules(hit("method", "protect")), ai([flag("prompt_injection", "high")]), small).outcome).toBe("block");
  });

  it("puts high severity evidence before rule reasons", () => {
    const d = decide(rules(hit("allowance", "block")), ai([{ ...flag("impersonation", "high"), why: "Pretending to be family." }]), small);
    expect(d.reasons[0]).toBe("Pretending to be family.");
  });

  it("explains itself with rule reasons and flag whys", () => {
    const d = decide(rules(hit("threshold", "ask")), ai([flag("pressure", "medium")]), small);
    expect(d.reasons).toEqual(["threshold", "w"]);
  });

  it("changed bank details hold the payment and say what to do: protected PayPal payment, ring a known number", () => {
    const d = decide(rules(), ai([flag("changed_bank_details", "high")]), small);
    expect(d.outcome).toBe("ask");
    expect(d.reasons[0]).toMatch(/protected PayPal payment or invoice/);
    expect(d.reasons[0]).toMatch(/ring the supplier on a number you already have/i);
    expect(decide(rules(), ai([flag("changed_bank_details", "medium")]), small).outcome).toBe("ask");
  });

  it("changed bank details with a bank transfer ask is switched to a protected payment", () => {
    const d = decide(rules(hit("method", "protect")), ai([flag("changed_bank_details", "high"), flag("changed_bank_details", "medium")]), small);
    expect(d.outcome).toBe("protect");
    expect(d.reasons.filter((r) => /ring the supplier/i.test(r))).toHaveLength(1);
  });

  it("a likely scam with a Friends and Family flag is held, not 'pay with protection': don't pay, ring them", () => {
    // The Hi Mum case: impersonation (high) plus the model also tagging "my mate's PayPal" as F&F.
    for (const scam of [flag("impersonation", "high"), flag("pressure", "high")]) {
      const d = decide(rules(), ai([scam, flag("friends_and_family", "high")]), small);
      expect(d.outcome).toBe("ask");
      expect(d.reasons[0]).toBe(SCAM_ADVICE);
      expect(d.reasons[0]).toMatch(/don't pay/i);
      expect(d.reasons[0]).toMatch(/number you already have/i);
    }
  });

  it("a likely scam that asks for Friends and Family by method is held too, and the protect advice is dropped", () => {
    const fnf: RuleHit = { rule: "method", outcome: "protect", reason: "Friends & Family payments have no buyer protection. Pay with a protected PayPal order instead." };
    const d = decide(rules(fnf), ai([flag("impersonation", "high")]), small);
    expect(d.outcome).toBe("ask");
    expect(d.reasons[0]).toBe(SCAM_ADVICE);
    expect(d.reasons).not.toContain(fnf.reason);
  });

  it("a likely scam still blocks when something else blocks it (gift cards, injection, allowance)", () => {
    expect(decide(rules(hit("allowance", "block")), ai([flag("impersonation", "high"), flag("friends_and_family", "high")]), small).outcome).toBe("block");
    expect(decide(rules(), ai([flag("impersonation", "high"), flag("gift_card_or_crypto", "high")]), small).outcome).toBe("block");
  });

  it("a genuine marketplace Friends and Family ask with no scam signs still says pay with protection", () => {
    const d = decide(rules(), ai([flag("friends_and_family", "high"), flag("pressure", "medium")]), small);
    expect(d.outcome).toBe("protect");
    expect(d.reasons).not.toContain(SCAM_ADVICE);
    expect(decide(rules(), ai([flag("impersonation", "medium"), flag("friends_and_family", "high")]), small).outcome).toBe("protect");
  });
});
