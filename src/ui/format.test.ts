import { describe, expect, it } from "vitest";
import { findQuotes, money, timeAgo, trackState } from "./format";

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
