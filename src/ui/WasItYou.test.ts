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
});
