import { describe, expect, it } from "vitest";
import { weekTally } from "./tally";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const p = (status: string, amount: number, hoursAgo = 1, currency = "GBP") => ({ status, amount, currency, created_at: new Date(NOW - hoursAgo * 3600_000).toISOString() });

describe("weekTally", () => {
  it("never counts held money as spent", () => {
    const t = weekTally([p("needs_approval", 25000), p("captured", 1840)], "GBP", NOW);
    expect(t).toEqual({ spent: 1840, onHold: 25000 });
  });

  it("counts money on its way (approved, paying) as spent, and ignores stopped, denied and failed", () => {
    const t = weekTally([p("authorised", 100), p("capturing", 200), p("blocked", 999), p("voided", 999), p("protected", 999), p("failed", 999), p("checking", 999)], "GBP", NOW);
    expect(t).toEqual({ spent: 300, onHold: 0 });
  });

  it("only this week and only this currency", () => {
    const t = weekTally([p("captured", 500, 24 * 8), p("captured", 700, 1, "USD"), p("needs_approval", 300, 24 * 8)], "GBP", NOW);
    expect(t).toEqual({ spent: 0, onHold: 0 });
  });
});
