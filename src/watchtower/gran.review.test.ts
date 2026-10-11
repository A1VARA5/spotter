// Review 2026-10-11 (docs/reviews/code-2026-10-11.md). These tests describe the behaviour the code should have;
// each one fails on the reviewed commit to prove a finding.
import { describe, expect, it } from "vitest";
import { granBoard, granForAgent, granLabels, granMonth } from "./gran";
import { toSources } from "./data";
import type { Payment, Spender } from "@/core/lifecycle";

const NOW = new Date("2026-10-11T12:00:00Z");

const spender = (id: string, name: string, kind: Spender["kind"], currency: "GBP" | "USD" = "GBP"): Spender => ({
  id,
  household_id: "hh_1",
  name,
  kind,
  spotter_name: "Sam",
  email: null,
  telegram_chat_id: null,
  discord_user_id: null,
  allowance: { weekly: { amount: 30000, currency }, askAbove: { amount: 5000, currency }, blockedCategories: [], allowedPayees: [], blockedPayees: [] },
});

const payment = (id: string, spenderId: string, status: string, amount: number, currency: "GBP" | "USD" = "GBP") =>
  ({
    id,
    spender_id: spenderId,
    status,
    amount: String(amount),
    currency,
    request: { id, spenderId, money: { amount, currency }, payee: { name: "Totally Real Bank", isNew: true }, category: "other", method: "paypal_order", context: "", createdAt: NOW.toISOString() },
    decision: { outcome: "block", reasons: ["This looks like a scam."], flags: [] },
    ai: null,
    market: null,
    case_file: null,
    paypal_order_id: null,
    paypal_authorization_id: null,
    paypal_capture_id: null,
    approve_url: null,
    created_at: new Date(NOW.getTime() - 3600_000).toISOString(),
    updated_at: NOW.toISOString(),
  }) as unknown as Payment;

describe("review: whose month the simple view shows", () => {
  it("finds the person's payments when their saved name has extra spaces (the label trims it, the rows don't)", () => {
    // gran.test.ts already expects padded names; setup trims the ends but not doubled spaces inside a name.
    const margaret = spender("sp_m", "Margaret  Smith", "person");
    const sources = toSources([payment("pay_1", "sp_m", "blocked", 25000)], [margaret], NOW);
    const labels = granLabels(sources.people, "family", "Sam");
    const month = granMonth(sources.payments, new Map(), { who: labels.who, spotter: labels.spotter, now: NOW });
    // Spotter stopped £250 for her this month; the simple view (and its my_month tool) should say so, not "nothing".
    expect(month.stopped).toHaveLength(1);
    // The board's page filter (payments.who equals ...) uses the same trimmed name, so the grid would be empty too.
    const filter = (granBoard(labels.who).pages[0] as unknown as { filter: { page: Array<{ model: { value: string } }> } }).filter.page[0]!.model.value;
    expect(sources.payments.filter((r) => r.who === filter)).toHaveLength(1);
  });
});

describe("review: money in the simple view", () => {
  it("doesn't read a dollar payment out as pounds", () => {
    // A business (or a family of agents) gets the simple view for everyone; an agent can hold a dollar allowance.
    const agent = spender("sp_a", "Buying agent", "agent", "USD");
    const sources = toSources([payment("pay_2", "sp_a", "blocked", 11900, "USD")], [agent], NOW);
    const month = granMonth(sources.payments, new Map(), { who: null, spotter: "Sam", now: NOW });
    const told = granForAgent(month, NOW);
    expect(told.stopped[0]!.amount).not.toBe("£119.00");
  });
});
