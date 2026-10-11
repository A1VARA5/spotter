import { describe, expect, it } from "vitest";
import { wiyStatus } from "./WasItYou";
import type { WasItYou } from "@/core/was-it-you";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const w = (over: Partial<WasItYou>): WasItYou =>
  ({
    id: "wiy_x",
    who: "Tom",
    claim: { name: "Tom", relation: null, quote: "it's Tom" },
    target: { kind: "spender", spenderId: "t", name: "Tom" },
    channel: "telegram",
    state: "asked",
    askedAt: "2026-10-11T11:50:00Z",
    expiresAt: "2026-10-11T12:50:00Z",
    ...over,
  }) as WasItYou;

describe("wiyStatus", () => {
  it("only says released when PayPal really released it", () => {
    expect(wiyStatus(w({ state: "not_me" }), "voided", NOW)).toMatchObject({ tone: "safe", state: "Tom: not me" });
    expect(wiyStatus(w({ state: "not_me" }), "captured", NOW).detail).toMatch(/already approved and paid/);
    expect(wiyStatus(w({ state: "not_me" }), "failed", NOW).detail).not.toMatch(/released the hold/);
  });

  it("an unanswered question that ran out stops saying waiting", () => {
    expect(wiyStatus(w({}), "needs_approval", NOW).state).toBe("Asked Tom");
    expect(wiyStatus(w({ expiresAt: "2026-10-11T11:59:00Z" }), "needs_approval", NOW)).toMatchObject({ tone: "ring", state: "Tom didn't answer" });
  });

  it("labels the demo's asks as examples", () => {
    expect(wiyStatus(w({ channel: "example", state: "it_was_me" }), "needs_approval", NOW).state).toBe("Example: Tom: it was me");
  });

  const mine = w({ who: "Sam", channel: "alert", target: { kind: "spotter", name: "Sam" }, claim: { name: null, relation: "child", quote: "Hi mum its me" } });

  it("a question for the spotter says why it's them, and never sends them to an alert they may not have", () => {
    const s = wiyStatus(mine, "needs_approval", NOW);
    expect(s.state).toBe("It says it's from you, Sam");
    expect(s.detail).toMatch(/Mum or Dad/);
    expect(s.detail).not.toMatch(/alert/i);
    expect(s.answer).toBe("here");
    const named = wiyStatus({ ...mine, claim: { name: "Sam", relation: null, quote: "it's Sam" } }, "needs_approval", NOW);
    expect(named.detail).toMatch(/uses your name/);
  });

  it("after the spotter answers their own question, it speaks to them as you", () => {
    expect(wiyStatus({ ...mine, state: "it_was_me" }, "needs_approval", NOW)).toMatchObject({ state: "You said it was you" });
    expect(wiyStatus({ ...mine, state: "not_me" }, "voided", NOW).state).toBe("You said not me");
  });

  it("the Try demo's example left behind can be answered here, as Tom, until it runs out", () => {
    const ex = w({ channel: "example", target: { kind: "example", name: "Tom" } });
    expect(wiyStatus(ex, "needs_approval", NOW)).toMatchObject({ state: "Example: Asked Tom", answer: "as" });
    const late = wiyStatus({ ...ex, expiresAt: "2026-10-11T11:59:00Z" }, "needs_approval", NOW);
    expect(late.state).toBe("Example: Tom didn't answer");
    expect(late.answer).toBeUndefined();
    expect(late.detail).toMatch(/still on hold/);
    expect(late.detail).toMatch(/[Dd]eny/);
  });

  it("no answer buttons for a real person's question, or once the payment isn't waiting", () => {
    expect(wiyStatus(w({}), "needs_approval", NOW).answer).toBeUndefined();
    expect(wiyStatus(mine, "voided", NOW).answer).toBeUndefined();
  });
});
