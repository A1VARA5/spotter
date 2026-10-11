import { describe, expect, it } from "vitest";
import { countdown, fairPrice, firstFew, pickCase, radarLines, replayDays, shortId, type PriceRow } from "./widgetLogic";

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

describe("fair price", () => {
  const pr = (over: Partial<PriceRow>): PriceRow => ({
    id: "p",
    when: h(-24),
    who: "Shopping agent",
    kind: "AI agent",
    payee: "Homeware Hub",
    amount: 20,
    outcome: "Paid",
    marketCheapest: 20,
    marketMedian: 22,
    priceGap: 0,
    marketShop: "kettle-co.example",
    marketItem: "Steel kettle",
    sample: false,
    ...over,
  });

  it("adds up what the agent paid over the cheapest real shop this month", () => {
    const f = fairPrice([pr({ id: "a", amount: 38, marketCheapest: 30, priceGap: 8 }), pr({ id: "b", amount: 30, marketCheapest: 20, priceGap: 10 }), pr({ id: "c" })], NOW);
    expect(f.overpaid).toBe(18);
    expect(f.checked).toBe(3);
    expect(f.headline).toBe("Your agent paid £18 more than the cheapest real shop this month");
    expect(f.items.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(f.items[0]!.verdict).toBe("over");
  });

  it("calls out a fake shop price Spotter caught against what real shops charge", () => {
    const f = fairPrice([pr({ id: "fake", amount: 24.99, outcome: "Stopped", marketCheapest: 159, marketMedian: 169, priceGap: -134.01, marketItem: "Pro wireless earbuds" })], NOW);
    expect(f.caught).toBe('Spotter caught a £24.99 "Pro wireless earbuds" that real shops sell for around £169');
    expect(f.items[0]!.verdict).toBe("fake");
    // Nothing was paid, so nothing was overpaid.
    expect(f.overpaid).toBe(0);
  });

  it("says when every paid price was fair, and names one person who isn't an agent", () => {
    expect(fairPrice([pr({ who: "Gran", kind: "Person" })], NOW).headline).toBe("Gran paid fair prices this month: never more than the cheapest real shop");
  });

  it("speaks for everyone when several people paid, and ignores rows with no price check or older than 30 days", () => {
    const f = fairPrice(
      [pr({ id: "a", priceGap: 2.5, amount: 22.5 }), pr({ id: "b", who: "Gran", kind: "Person", priceGap: 1, amount: 21 }), pr({ id: "none", marketCheapest: null, marketMedian: null, priceGap: null }), pr({ id: "old", when: h(-24 * 40), priceGap: 50 })],
      NOW,
    );
    expect(f.checked).toBe(2);
    expect(f.headline).toBe("Everyone together paid £3.50 more than the cheapest real shop this month");
  });

  it("has nothing to say without a price check", () => {
    expect(fairPrice([pr({ marketCheapest: null, marketMedian: null, priceGap: null })], NOW)).toMatchObject({ checked: 0, headline: "", caught: null, items: [] });
  });
});

describe("tiles show the first few and say how many more", () => {
  it("keeps the first n in order and counts the rest", () => {
    expect(firstFew([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 });
  });
  it("shows everything when it fits", () => {
    expect(firstFew(["a"], 3)).toEqual({ shown: ["a"], more: 0 });
    expect(firstFew([], 3)).toEqual({ shown: [], more: 0 });
  });
});
