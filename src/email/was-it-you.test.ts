import { describe, expect, it } from "vitest";
import { alertEmail, askEmail } from "./alerts";
import type { Payment, Spender } from "@/core/lifecycle";
import type { WasItYou } from "@/core/was-it-you";

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";

const gran = { id: "gran", household_id: "hh", name: "Gran", kind: "person", spotter_name: "Sam" } as unknown as Spender;
const w = (over: Partial<WasItYou> = {}): WasItYou =>
  ({
    id: "wiy_abcdefghijkl",
    who: "Tom",
    claim: { name: "Tom", relation: null, quote: "it's Tom" },
    target: { kind: "spender", spenderId: "tom", name: "Tom" },
    channel: "email",
    state: "asked",
    askedAt: "",
    expiresAt: "",
    ...over,
  }) as WasItYou;
const p = (over: Partial<Payment> = {}) =>
  ({
    id: "pay_1",
    status: "needs_approval",
    amount: 25000,
    currency: "GBP",
    request: { payee: { name: "jamie@mail.example" }, context: "Hi Mum it's Tom, new number <b>x</b>", method: "paypal_order", category: "family" },
    decision: { outcome: "ask", reasons: [] },
    ai: null,
    ...over,
  }) as unknown as Payment;

describe("Was it you? by email", () => {
  it("asks Tom with a link to answer, never answering on open", () => {
    const e = askEmail(p(), gran, w(), "https://s.test");
    expect(e.subject).toBe("Did you message Gran asking for money?");
    expect(e.html).toContain("Did you message Gran from a new number asking for £250.00?");
    expect(e.html).toMatch(/https:\/\/s\.test\/was-it-you\?t=wiy_abcdefghijkl\.[A-Za-z0-9_-]{22}/);
    expect(e.text).toContain("/was-it-you?t=");
  });

  it("the spotter's alert links to the question when the message claims to be them", () => {
    const e = alertEmail(p({ was_it_you: w({ who: "Sam", target: { kind: "spotter", name: "Sam" }, channel: "alert" }) }), gran, "https://s.test");
    expect(e.html).toContain("Did you message Gran");
    expect(e.html).toContain("/was-it-you?t=");
  });

  it("otherwise says who was asked, or to ring them", () => {
    expect(alertEmail(p({ was_it_you: w({ channel: "telegram" }) }), gran, "https://s.test").html).toContain("Spotter asked Tom if they sent it");
    expect(alertEmail(p({ was_it_you: w({ state: "no_channel", channel: null }) }), gran, "https://s.test").text).toContain("Ring Tom");
  });
});
