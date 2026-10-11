// One line "why": the strongest sign wins, never the weakest rule that happens to come first.
import { describe, expect, it } from "vitest";
import type { Flag } from "./grounding";
import type { Decision } from "./decide";
import { decidedReason, rankedReasons, topReason } from "./reasons";
import { PAUSED_BY } from "./decidedBy";
import { SCAM_ADVICE } from "./decide";

const flag = (kind: Flag["kind"], severity: Flag["severity"], why: string): Flag => ({ kind, severity, quote: "", why });
const decision = (reasons: string[], flags: Flag[] = []): Decision => ({ outcome: "ask", reasons, flags });

const INJECTION = "It hides text from people that an AI still reads, a way to slip orders to an AI.";
const FIRST = "First time paying GadgetBarn.";
const LIMIT = 'Over the £5.00 "ask me first" limit.';
const PRICE = "£4.99 is far below what real shops charge (around £15.99 across 3 retailers). Prices this low are a fake shop tell.";
const PRESSURE = "It rushes you to pay within 24 hours.";

describe("topReason", () => {
  it("a stopped booby trapped shop: the hidden orders, not 'first time paying'", () => {
    const d = decision([FIRST, INJECTION, LIMIT], [flag("prompt_injection", "high", INJECTION)]);
    expect(topReason({ decision: d })).toBe(INJECTION);
  });

  it("uses the case file's code made proof when the message check didn't see it", () => {
    const d = decision([FIRST, LIMIT]);
    const case_file = { findings: [{ kind: "prompt_injection" as const, severity: "high" as const, text: "The shop page hides text from people...", tool: "inspect_shop", source: "x" }] };
    expect(topReason({ decision: d, case_file })).toBe("The shop page hides orders for AI agents.");
    const faces = { findings: [{ kind: "cloaking" as const, severity: "high" as const, text: "...", tool: "open_link", source: "x" }] };
    expect(topReason({ decision: decision(["First time paying Larkhill Parcels."]), case_file: faces })).toBe("The link shows phones a card form it hides from security scanners.");
    const tool = { findings: [{ kind: "prompt_injection" as const, severity: "high" as const, toolName: "add_to_cart", text: "...", tool: "inspect_shop", source: "x" }] };
    expect(topReason({ decision: d, case_file: tool })).toBe("The shop gives AI agents a tool with hidden orders in it.");
    const trail = { findings: [{ kind: "money_offsite" as const, severity: "high" as const, text: "...", tool: "open_link", source: "x" }] };
    expect(topReason({ decision: d, case_file: trail })).toBe("Card details typed on this page would go to a different site.");
  });

  it("a fake shop price beats the rules: medium or high price signs come before 'first time paying' and the limit", () => {
    const d = decision([FIRST, LIMIT, PRICE], [flag("price", "high", PRICE)]);
    expect(topReason({ decision: d })).toBe(PRICE);
    const medium = decision([LIMIT, FIRST, PRESSURE], [flag("pressure", "medium", PRESSURE)]);
    expect(topReason({ decision: medium })).toBe(PRESSURE);
  });

  it("a rule beats 'first time paying', and 'first time paying' beats a low sign", () => {
    expect(topReason({ decision: decision([FIRST, LIMIT]) })).toBe(LIMIT);
    expect(topReason({ decision: decision(["Invisible spaces were hidden in the text.", FIRST], [flag("other", "low", "Invisible spaces were hidden in the text.")]) })).toBe(FIRST);
  });

  it("high signs keep their order of seriousness, and the scam advice never pushes the sign itself aside", () => {
    const imp = "It claims to be your son from a new number.";
    const d = decision([SCAM_ADVICE, imp, PRESSURE], [flag("pressure", "high", PRESSURE), flag("impersonation", "high", imp)]);
    expect(topReason({ decision: d })).toBe(imp);
  });

  it("the AI being down is said before rules, after real signs", () => {
    const down = "The AI check didn't run, so this needs your yes.";
    expect(topReason({ decision: decision([down, FIRST]) })).toBe(down);
    expect(topReason({ decision: decision([down, INJECTION], [flag("prompt_injection", "high", INJECTION)]) })).toBe(INJECTION);
  });

  it("a tripwire pause leads", () => {
    const paused = "Naive test agent was paused by a tripwire while this was being checked. Nothing was sent to PayPal.";
    expect(topReason({ decision: decision([paused, INJECTION], [flag("prompt_injection", "high", INJECTION)]) })).toBe(paused);
  });

  it("nothing to say: null", () => {
    expect(topReason({ decision: null })).toBeNull();
    expect(topReason({ decision: decision([]) })).toBeNull();
  });
});

describe("rankedReasons", () => {
  it("keeps every reason once, strongest first", () => {
    const d = decision([FIRST, INJECTION, LIMIT], [flag("prompt_injection", "high", INJECTION)]);
    expect(rankedReasons({ decision: d })).toEqual([INJECTION, LIMIT, FIRST]);
  });
});

describe("decidedReason: once decided, the why is in the past tense", () => {
  const base = { status: "needs_approval", decided_by: null as string | null, error: null, amount: 499, currency: "GBP", request: { payee: { name: "Panmoor Kitchen" } } };
  const held = decision([FIRST, PRICE], [flag("price", "high", PRICE)]);
  it("still waiting: the reason as it is", () => {
    expect(decidedReason({ ...base, decision: held })).toBe(PRICE);
  });
  it("paid after a hold: held because, in the past tense, then who approved", () => {
    const r = decidedReason({ ...base, status: "captured", decided_by: "Sam", decision: held });
    expect(r).toBe("Held because £4.99 was far below what real shops charge (around £15.99 across 3 retailers). Paid after Sam approved.");
    expect(r).not.toMatch(/fake shop tell| is far below/);
  });
  it("denied and not me: held because", () => {
    expect(decidedReason({ ...base, status: "voided", decided_by: "Sam", decision: decision([FIRST]) })).toBe("Held because it was the first time paying GadgetBarn.");
    const proof = { findings: [{ kind: "cloaking" as const, severity: "high" as const }] };
    expect(decidedReason({ ...base, status: "voided", decided_by: "Tom", was_it_you: { state: "not_me", who: "Tom" }, decision: decision([FIRST]), case_file: proof })).toBe(
      "Held because the link showed phones a card form it hid from security scanners.",
    );
  });
  it("stopped: stopped because; an AI sign it can't rewrite keeps its words after a short 'Stopped:' label", () => {
    const d = decision([INJECTION], [flag("prompt_injection", "high", INJECTION)]);
    expect(decidedReason({ ...base, status: "blocked", decision: d })).toBe(`Stopped: ${INJECTION}`);
    expect(decidedReason({ ...base, status: "blocked", decision: decision([LIMIT]) })).toBe('Stopped because it was over the £5.00 "ask me first" limit.');
  });
  it("paid within the rules: no reason; a tripwire keeps its own past tense line", () => {
    expect(decidedReason({ ...base, status: "captured", decided_by: "Spotter", decision: { outcome: "allow", reasons: [], flags: [] } })).toBeNull();
    const trip = decidedReason({ ...base, status: "voided", decided_by: PAUSED_BY, tripwire: { id: "t", tool: "create_refund", at: "", cause: null }, decision: decision([LIMIT]) });
    expect(trip).toMatch(/^Reached for create_refund/);
  });
});
