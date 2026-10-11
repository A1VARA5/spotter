import { describe, expect, it } from "vitest";
import { findQuotes, money, paypalPending, replacementLink, timeAgo, trackState } from "./format";

describe("paypalPending", () => {
  it("says PayPal didn't confirm yet for a void or capture left for retry, and nothing otherwise", () => {
    expect(paypalPending({ status: "voiding", error: "PayPal didn't confirm yet, Spotter is retrying: timeout" })).toEqual({
      kind: "void",
      text: "PayPal didn't confirm yet, retrying. Nothing was paid, and Spotter keeps asking PayPal to let the hold go.",
    });
    expect(paypalPending({ status: "capturing", error: "PayPal didn't confirm yet, Spotter is retrying: 503" })?.kind).toBe("capture");
    expect(paypalPending({ status: "voiding", error: null })).toBeNull();
    expect(paypalPending({ status: "voided", error: "old" })).toBeNull();
  });
});

describe("ui format", () => {
  it("formats minor units as money", () => {
    expect(money(2499, "GBP")).toBe("£24.99");
    expect(money("40000", "USD")).toBe("US$400.00");
  });

  it("maps every status to a track state", () => {
    expect(trackState("needs_approval")).toBe("held");
    expect(trackState("captured")).toBe("paid");
    expect(trackState("voided")).toBe("returned");
  });

  it("finds quotes across whitespace and case, without overlaps", () => {
    const text = "Hi Mum, it's me.\nSend it Friends   and Family please!";
    const r = findQuotes(text, ["friends and family please", "Family", "not here"]);
    expect(r).toHaveLength(1);
    expect(text.slice(r[0]!.start, r[0]!.end)).toBe("Friends   and Family please");
  });

  it("escapes regex characters in quotes", () => {
    expect(findQuotes("price (£19.99)?", ["(£19.99)?"])).toHaveLength(1);
  });

  it("says just now, minutes, hours", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(timeAgo("2026-10-09T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-10-09T11:50:00Z", now)).toBe("10 min ago");
    expect(timeAgo("2026-10-09T09:00:00Z", now)).toBe("3 h ago");
  });
});

describe("replacement links", () => {
  type P = Parameters<typeof replacementLink>[0];
  const pay = (id: string, payee: string, status: string, amount: number, extra: Record<string, unknown> = {}) =>
    ({ id, status, amount, currency: "GBP", request: { payee: { name: payee }, ...extra } }) as unknown as P;
  const stopped = pay("p1", "GadgetBarn", "blocked", 1999);
  const bought = pay("p2", "currys.co.uk", "captured", 17900, {
    swappedFrom: "p1",
    saferOption: { offer_id: "offer_x", reason: "hidden instructions", from_payee: "GadgetBarn" },
  });

  it("tells the agent's whole story on the replacement", () => {
    expect(replacementLink(bought, [bought, stopped], "Shopping agent")).toEqual({
      id: "p1",
      text: "Shopping agent tried GadgetBarn (stopped: hidden instructions), then bought from currys.co.uk for £179.00 instead.",
    });
    const waiting = { ...bought, status: "needs_approval" } as P;
    expect(replacementLink(waiting, [stopped], "Shopping agent")!.text).toMatch(/then asked to buy from currys\.co\.uk for £179\.00 instead\.$/);
  });

  it("links the stopped payment to what replaced it", () => {
    expect(replacementLink(stopped, [bought, stopped], "Shopping agent")).toEqual({ id: "p2", text: "Replaced by currys.co.uk, £179.00 (Paid)." });
  });

  it("says held, not stopped, when the first payment was only held, and handles the spotter's own swap", () => {
    const released = pay("p1", "NewBuds", "voided", 1999);
    const fromHeld = { ...bought, request: { ...bought.request, saferOption: { offer_id: "o", reason: "brand new shop", from_payee: "NewBuds" } } } as P;
    expect(replacementLink(fromHeld, [released], "Shopping agent")!.text).toMatch(/^Shopping agent tried NewBuds \(held: brand new shop\)/);
    const swapped = pay("p3", "apple.com", "captured", 21900, { swappedFrom: "p1" });
    expect(replacementLink(swapped, [released], "Gran")!.text).toBe("Bought instead of the held payment to NewBuds.");
  });

  it("is null for a payment with no link", () => {
    expect(replacementLink(pay("p9", "Clay & Kiln", "captured", 2499), [stopped], "Gran")).toBeNull();
  });
});
