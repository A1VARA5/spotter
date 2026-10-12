// After a decision, every place that tells the story (the case file, the Activity drawer, the reasons line, the
// evidence pack) says what happened, in the past tense. Nothing says the money is still held once it isn't.
import { describe, expect, it } from "vitest";
import type { Case } from "@/agents/case";
import { holdFact, outcomeLine, settledAs, settledCase, shownOutcome, type SettledInput } from "./settled";
import { LATE_BY, LATE_HOLD, PAUSED_BY } from "./lifecycle";
import { CAPTURED_WHILE_RELEASING } from "./decidedBy";

const p = (over: Partial<SettledInput> = {}): SettledInput => ({
  status: "captured",
  decided_by: "Sam",
  error: null,
  amount: 699,
  currency: "GBP",
  request: { payee: { name: "Panmoor Kitchen" } },
  was_it_you: null,
  ...over,
});

const HELD = "PayPal is holding the money, so nothing has been paid yet. If nobody approves it by Monday 9 November, the hold ends and nothing is paid.";
const c: Case = {
  status: "done",
  verdict: "unclear",
  headline: "This skillet costs far less than real shops charge.",
  findings: [
    { text: "Real retailers list cast iron skillets from £15.99.", tool: "find_genuine_offer", source: "t1" },
    { text: "This family has never paid Panmoor Kitchen before.", tool: "payee_history", source: "t2" },
    { text: HELD, tool: "paypal_hold", source: "t3" },
  ],
  ask: ["Check the shop's reviews."],
  calls: [],
  dropped: 0,
  model: "test",
  ms: 1,
};

const HOLDING = /holding the money|nothing has been paid yet|If nobody approves/i;

describe("settledAs", () => {
  it("names each state after a decision, and nothing while it still waits", () => {
    expect(settledAs(p({ status: "needs_approval" }))).toBeNull();
    expect(settledAs(p({ status: "checking" }))).toBeNull();
    expect(settledAs(p())).toBe("paid");
    expect(settledAs(p({ decided_by: "Spotter" }))).toBe("paid_by_rules");
    expect(settledAs(p({ status: "capturing" }))).toBe("paying");
    expect(settledAs(p({ status: "voided" }))).toBe("denied");
    expect(settledAs(p({ status: "voiding" }))).toBe("releasing");
    expect(settledAs(p({ status: "voided", decided_by: PAUSED_BY }))).toBe("paused");
    expect(settledAs(p({ status: "voided", decided_by: LATE_BY, error: LATE_HOLD }))).toBe("late");
    expect(settledAs(p({ status: "voided", decided_by: "Sam", error: "PayPal let the hold lapse before the payment went through. Nothing was paid." }))).toBe("lapsed");
    expect(settledAs(p({ status: "voided", decided_by: null }))).toBe("released");
    expect(settledAs(p({ status: "voided", decided_by: "Tom", was_it_you: { state: "not_me", who: "Tom" } }))).toBe("not_me");
    expect(settledAs(p({ status: "blocked" }))).toBe("stopped");
    expect(settledAs(p({ status: "protected" }))).toBe("not_sent");
    expect(settledAs(p({ status: "failed", error: "PayPal denied the capture, so nothing was paid." }))).toBe("failed");
  });
});

describe("outcomeLine", () => {
  it("says what happened, in the past tense, with who decided", () => {
    expect(outcomeLine(p())).toBe("Paid. Sam approved it, so PayPal paid £6.99 to Panmoor Kitchen.");
    expect(outcomeLine(p({ decided_by: "Spotter" }))).toBe("Paid. It was within the rules, so PayPal paid £6.99 to Panmoor Kitchen.");
    expect(outcomeLine(p({ status: "voided" }))).toBe("Denied. Sam said no, so PayPal cancelled the £6.99 hold. Nothing was paid.");
    expect(outcomeLine(p({ status: "voided", decided_by: "Tom", was_it_you: { state: "not_me", who: "Tom" } }))).toBe(
      "Cancelled. Tom said the message wasn't from them, so PayPal cancelled the £6.99 hold. Nothing was paid.",
    );
    expect(outcomeLine(p({ status: "voided", decided_by: PAUSED_BY }))).toBe("Stopped: agent paused. Spotter had paused this agent, so PayPal cancelled the hold. Nothing was paid.");
    expect(outcomeLine(p({ status: "voided", decided_by: LATE_BY, error: LATE_HOLD }))).toBe(LATE_HOLD);
    expect(outcomeLine(p({ status: "blocked" }))).toBe("Stopped. Spotter stopped it before anything reached PayPal. Nothing was paid.");
    expect(outcomeLine(p({ status: "protected" }))).toMatch(/^Not sent\..*no buyer protection/);
    expect(outcomeLine(p({ status: "failed", error: "PayPal denied the capture, so nothing was paid." }))).toBe("Not paid. PayPal denied the capture, so nothing was paid.");
    expect(outcomeLine(p({ status: "needs_approval" }))).toBeNull();
  });
});

describe("paid although Spotter was letting it go", () => {
  it("never says the person who said no approved it", () => {
    const q = p({ status: "captured", decided_by: "Sam", error: CAPTURED_WHILE_RELEASING });
    expect(settledAs(q)).toBe("paid_anyway");
    expect(outcomeLine(q)).toBe("Paid, although Spotter was letting it go: PayPal took £6.99 for Panmoor Kitchen. Check it in PayPal.");
    expect(outcomeLine(q)).not.toMatch(/approved/);
    expect(holdFact(q)).toMatch(/PayPal took the money although Spotter was letting the hold go/);
  });
});

describe("holdFact and settledCase", () => {
  it("replaces the PayPal hold line with what PayPal did, for every state after a decision", () => {
    const states: Array<Partial<SettledInput>> = [
      {},
      { decided_by: "Spotter" },
      { status: "capturing" },
      { status: "voided" },
      { status: "voiding" },
      { status: "voided", decided_by: PAUSED_BY },
      { status: "voided", decided_by: LATE_BY, error: LATE_HOLD },
      { status: "voided", error: "PayPal let the hold lapse before the payment went through. Nothing was paid." },
      { status: "blocked" },
      { status: "protected" },
      { status: "failed", error: "PayPal denied the capture, so nothing was paid." },
    ];
    for (const s of states) {
      const out = settledCase(c, p(s));
      const hold = out.findings.find((f) => f.tool === "paypal_hold");
      expect(hold?.text ?? "", JSON.stringify(s)).not.toMatch(HOLDING);
      expect(JSON.stringify(out.findings)).not.toMatch(HOLDING);
      expect(out.ask).toEqual([]);
    }
    expect(holdFact(p())).toBe("PayPal paid it: the money went to Panmoor Kitchen.");
    expect(holdFact(p({ status: "voided" }))).toBe("PayPal cancelled the hold, so nothing was paid.");
    expect(holdFact(p({ status: "voided", error: "PayPal let the hold lapse before the payment went through. Nothing was paid." }))).toBe(
      "The hold ran out before the payment went through, so nothing was paid.",
    );
  });

  it("leaves a payment that still waits exactly as it is", () => {
    expect(settledCase(c, p({ status: "needs_approval" }))).toBe(c);
  });

  it("keeps the other findings and their order", () => {
    const out = settledCase(c, p());
    expect(out.findings.map((f) => f.tool)).toEqual(["find_genuine_offer", "payee_history", "paypal_hold"]);
  });
});

describe("shownOutcome: a Not me release has its own words, never a person's Deny", () => {
  const wiy = (who: string, channel: string) => ({ state: "not_me", who, channel });
  it("Tom said not me: Not me, Tom didn't send it (the pill fits the rail; the line under it says PayPal released it)", () => {
    const o = shownOutcome(p({ status: "voided", decided_by: "Tom", was_it_you: wiy("Tom", "example") }));
    expect(o).toMatchObject({ state: "returned", short: "Not me" });
    expect(o?.long).toBe("Not me: Tom didn't send it");
    expect(o?.long).not.toMatch(/denied/i);
  });
  it("the spotter answered their own question: talks to them as you", () => {
    const o = shownOutcome(p({ status: "voided", decided_by: "Sam", was_it_you: wiy("Sam", "alert") }));
    expect(o?.long).toBe("Not me: you didn't send it");
  });
  it("a real Deny stays Denied, a tripwire stays Stopped, a waiting payment has no special words", () => {
    expect(shownOutcome(p({ status: "voided", decided_by: "Sam", was_it_you: null }))).toBeNull();
    expect(shownOutcome(p({ status: "voided", decided_by: "Sam", was_it_you: wiy("Tom", "example") }))).toBeNull();
    expect(shownOutcome(p({ status: "needs_approval", decided_by: null, was_it_you: { state: "asked", who: "Tom" } }))).toBeNull();
    expect(shownOutcome(p({ status: "voided", decided_by: PAUSED_BY }))?.long).toMatch(/^Stopped/);
  });
});
