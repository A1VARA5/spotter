import { describe, expect, it } from "vitest";
import { countdown, pickCase, radarLines, replayDays, shortId } from "./widgetLogic";

const NOW = new Date("2026-10-10T12:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() + hours * 3600_000);

describe("PayPal hold countdown", () => {
  it("counts down to PayPal's real expiry", () => {
    expect(countdown(h(52), h(-20), NOW)).toEqual({ text: "expires in 2 days 4 hours", about: false, expired: false, elapsed: 20 / 72 });
  });

  it("guesses three days from when it was held when PayPal's expiry isn't known, and says it's a guess", () => {
    const c = countdown(null, h(-2), NOW);
    expect(c.text).toBe("expires in about 2 days 22 hours");
    expect(c.about).toBe(true);
  });

  it("speaks in hours and minutes near the end, and says when it has run out", () => {
    expect(countdown(h(3.5), h(-60), NOW).text).toBe("expires in 3 hours 30 minutes");
    expect(countdown(h(0.25), h(-60), NOW).text).toBe("expires in 15 minutes");
    expect(countdown(h(1), h(-60), NOW).text).toBe("expires in 1 hour");
    expect(countdown(h(-1), h(-80), NOW)).toMatchObject({ text: "PayPal's hold has run out", expired: true, elapsed: 1 });
  });
});

describe("short PayPal ids", () => {
  it("keeps the ends of a long id", () => {
    expect(shortId("3XK12345AB678901C")).toBe("3XK1…901C");
    expect(shortId("SHORT")).toBe("SHORT");
    expect(shortId("")).toBe("");
  });
});

describe("the month without Spotter", () => {
  const rows = [
    { when: h(-24 * 9), amount: 49.99, outcome: "Stopped", who: "Gran", payee: "Tax Refunds Team" },
    { when: h(-24 * 9 + 2), amount: 20, outcome: "Paid", who: "Leo", payee: "BlockWorld" },
    { when: h(-24 * 4), amount: 85, outcome: "Protected", who: "Gran", payee: "Dave" },
    { when: h(-3), amount: 400, outcome: "Denied", who: "Gran", payee: "New number" },
  ];

  it("plays day by day from the first payment to today, adding up what was kept and what would have gone", () => {
    const days = replayDays(rows, NOW);
    expect(days).toHaveLength(10);
    expect(days[0]).toMatchObject({ kept: 49.99, gone: 49.99, events: [{ amount: 49.99, outcome: "Stopped", who: "Gran", payee: "Tax Refunds Team" }] });
    expect(days[5]).toMatchObject({ kept: 49.99, gone: 134.99, protectedSoFar: 85 });
    expect(days.at(-1)).toMatchObject({ kept: 449.99, gone: 534.99, protectedSoFar: 85 });
    expect(days.flatMap((d) => d.events).map((e) => e.outcome)).not.toContain("Paid");
  });

  it("keeps to the last 31 days and is empty with no rows", () => {
    expect(replayDays([{ when: h(-24 * 60), amount: 5, outcome: "Stopped", who: "A", payee: "B" }], NOW)).toHaveLength(31);
    expect(replayDays([], NOW)).toEqual([]);
  });
});

describe("case file pick", () => {
  it("shows the newest payment Spotter stepped in on, or the newest payment", () => {
    const rows = [
      { id: "a", when: h(-1), outcome: "Paid" },
      { id: "b", when: h(-5), outcome: "Stopped" },
      { id: "c", when: h(-9), outcome: "Waiting" },
    ];
    expect(pickCase(rows)).toBe("b");
    expect(pickCase([{ id: "a", when: h(-1), outcome: "Paid" }])).toBe("a");
    expect(pickCase([])).toBeNull();
  });
});

describe("scam radar lines", () => {
  it("lists the family's stopped or denied payees with how many other families stopped them", () => {
    const rows = [
      { payee: "parcel-redelivery.co", outcome: "Stopped" },
      { payee: "Parcel-Redelivery.co ", outcome: "Denied" },
      { payee: "Tax Refunds Team", outcome: "Stopped" },
      { payee: "Corner Grocer", outcome: "Paid" },
    ];
    const counts = { "parcel-redelivery.co": { families: 4, sample: true }, "tax refunds team": { families: 0 } };
    expect(radarLines(rows, counts)).toEqual([
      { payee: "parcel-redelivery.co", families: 4, sample: true, text: "Stopped for 4 other families in the last 30 days" },
      { payee: "Tax Refunds Team", families: 0, sample: false, text: "No other Spotter family has reported it yet" },
    ]);
    expect(radarLines([{ payee: "X", outcome: "Stopped" }], { x: { families: 1 } })[0]!.text).toBe("Stopped for 1 other family in the last 30 days");
  });
});
