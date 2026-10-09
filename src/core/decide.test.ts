import { describe, expect, it } from "vitest";
import { decide } from "./decide";
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

  it("blocks on a high prompt injection or impersonation flag", () => {
    expect(decide(rules(), ai([flag("prompt_injection", "high")]), small).outcome).toBe("block");
    expect(decide(rules(), ai([flag("impersonation", "high")]), small).outcome).toBe("block");
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
    const kinds: FlagKind[] = ["pressure", "impersonation", "friends_and_family", "gift_card_or_crypto", "prompt_injection", "price", "new_shop", "other"];
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
});
