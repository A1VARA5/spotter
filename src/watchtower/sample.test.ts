import { describe, expect, it } from "vitest";
import { sampleMonth } from "./sample";
import { SAMPLE_PREFIX, toSources, watchAlerts } from "./data";
import type { Spender } from "@/core/lifecycle";

const NOW = new Date("2026-10-10T12:00:00Z");
const s = (id: string, name: string, kind: Spender["kind"]): Spender => ({
  id,
  household_id: "hh",
  name,
  kind,
  spotter_name: "Sam",
  email: null,
  telegram_chat_id: null,
  discord_user_id: null,
  allowance: { weekly: { amount: 30000, currency: "GBP" }, askAbove: { amount: 5000, currency: "GBP" }, blockedCategories: [], allowedPayees: [], blockedPayees: [] },
});
const family = [s("sp_a", "Shopping agent", "agent"), s("sp_g", "Gran", "person"), s("sp_l", "Leo", "kid")];

describe("sample month", () => {
  it("is labelled, within the last 30 days, and the same every time", () => {
    const a = sampleMonth(family, NOW);
    expect(a.length).toBeGreaterThan(25);
    expect(a.every((p) => p.id.startsWith(SAMPLE_PREFIX))).toBe(true);
    expect(a.every((p) => NOW.getTime() - new Date(p.created_at).getTime() <= 30 * 86400_000)).toBe(true);
    expect(sampleMonth(family, NOW)).toEqual(a);
  });

  it("covers paid, stopped, denied and protected payments for every kind of spender, and never leaves one waiting", () => {
    const { payments } = toSources(sampleMonth(family, NOW), family, NOW);
    const outcomes = new Set(payments.map((r) => r.outcome));
    for (const o of ["Paid", "Stopped", "Denied", "Protected"]) expect(outcomes).toContain(o);
    expect(outcomes).not.toContain("Waiting");
    for (const who of ["Shopping agent", "Gran", "Leo"]) expect(payments.some((r) => r.who === who && r.signs > 0)).toBe(true);
  });

  it("tells a story the watch alerts pick up", () => {
    const { payments } = toSources(sampleMonth(family, NOW), family, NOW);
    expect(watchAlerts(payments, NOW).map((a) => a.kind).sort()).toEqual(["new_sign", "repeat_payee", "spike"]);
  });

  it("is empty when the family has nobody to match", () => {
    expect(sampleMonth([], NOW)).toEqual([]);
  });
});
