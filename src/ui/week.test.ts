import { describe, expect, it } from "vitest";
import { weekSummary } from "./week";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const p = (status: string, amount: number, daysAgo: number, over: Record<string, unknown> = {}) => ({
  id: `p${Math.random()}`,
  status,
  amount: String(amount),
  currency: "GBP",
  created_at: new Date(NOW - daysAgo * DAY).toISOString(),
  case_file: null,
  ...over,
});

describe("weekSummary", () => {
  it("counts the last 7 days by outcome and adds up the money stopped before it moved", () => {
    const s = weekSummary(
      [
        p("captured", 1299, 1),
        p("captured", 4500, 6),
        p("blocked", 25000, 2),
        p("voided", 2499, 3),
        p("protected", 19900, 4),
        p("needs_approval", 5000, 0),
        p("captured", 9999, 8), // older than a week
      ] as never,
      NOW,
    );
    expect(s).toMatchObject({ checked: 6, paid: 2, stopped: 3, waiting: 1 });
    expect(s.kept).toEqual([{ currency: "GBP", amount: 47399 }]);
  });

  it("leaves out the demo's labelled example hold and keeps currencies apart", () => {
    const s = weekSummary(
      [p("needs_approval", 5000, 0, { case_file: { example: true } }), p("blocked", 1000, 1), p("blocked", 2000, 1, { currency: "USD" })] as never,
      NOW,
    );
    expect(s.checked).toBe(2);
    expect(s.waiting).toBe(0);
    expect(s.kept).toEqual([
      { currency: "USD", amount: 2000 },
      { currency: "GBP", amount: 1000 },
    ]);
  });

  it("is all zeros for a quiet week", () => {
    expect(weekSummary([], NOW)).toEqual({ checked: 0, paid: 0, stopped: 0, waiting: 0, kept: [] });
  });
});
