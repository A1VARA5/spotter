import { describe, expect, it } from "vitest";
import { LIVE_ITEMS, fairBrief, todayLine, todayUnavailable } from "./fair";
import type { PaymentRow } from "./data";

const NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 86_400_000;
const row = (o: Partial<PaymentRow> & { id: string }): PaymentRow =>
  ({
    when: new Date(NOW.getTime() - 2 * DAY),
    who: "Shopping agent",
    kind: "AI agent",
    payee: "Everything Store",
    amount: 20,
    outcome: "Paid",
    marketCheapest: null,
    marketMedian: null,
    priceGap: null,
    marketShop: "",
    marketItem: "",
    sample: "No",
    ...o,
  }) as PaymentRow;

const lamp = row({ id: "p1", amount: 29.99, marketItem: "LED desk lamp", marketCheapest: 24.99, marketMedian: 27, priceGap: 5, marketShop: "lamps.example", sample: "Yes" });
const kettle = row({ id: "p2", amount: 18.99, marketItem: "Steel kettle 1.7L", marketCheapest: 15.49, marketMedian: 16.99, priceGap: 3.5, marketShop: "copperpot.example", sample: "Yes" });
const earbuds = row({ id: "p3", amount: 24.99, outcome: "Stopped", marketItem: "Pro wireless earbuds 2", marketCheapest: 159, marketMedian: 169, priceGap: -134.01, marketShop: "audio.example", sample: "Yes" });
const unchecked = row({ id: "p4", amount: 300, marketItem: "" });

describe("fair prices for the assistant (no data agent hop)", () => {
  it("answers from the board's stored price checks: overpaid total, the paid items, and which rows are sample", () => {
    const b = fairBrief([lamp, kettle, earbuds, unchecked], NOW);
    expect(b.checked).toBe(3);
    expect(b.paidChecked).toBe(2);
    expect(b.overpaid).toBe(8.5);
    expect(b.allSample).toBe(true);
    expect(b.items.map((i) => i.item)).toEqual(["Pro wireless earbuds 2", "LED desk lamp", "Steel kettle 1.7L"]);
    expect(b.items[1]).toMatchObject({ amount: 29.99, wasPaid: true, cheapestThen: 24.99, gapToCheapest: 5, outcome: "Paid", sample: true });
    // no ids reach the assistant
    expect(JSON.stringify(b)).not.toMatch(/"p\d"/);
  });

  it("picks the biggest paid items for today's live check, each item once, at most LIVE_ITEMS", () => {
    const twin = row({ id: "p5", amount: 40, marketItem: "LED desk lamp", marketCheapest: 24.99, marketMedian: 27, priceGap: 15 });
    const b = fairBrief([kettle, lamp, earbuds, twin, row({ id: "p6", amount: 5, marketItem: "Tea towel", marketCheapest: 4, marketMedian: 5, priceGap: 1 })], NOW);
    expect(LIVE_ITEMS).toBe(2);
    expect(b.liveItems).toEqual(["LED desk lamp", "Steel kettle 1.7L"]);
  });

  it("never live checks a stopped payment's item, and says plainly when nothing paid had a check", () => {
    const b = fairBrief([earbuds, unchecked], NOW);
    expect(b.liveItems).toEqual([]);
    expect(b.paidChecked).toBe(0);
    expect(b.allSample).toBe(true);
  });

  it("flags a paid price far below real shops as a scam sign, never a good price or a saving", () => {
    const skillet = row({ id: "p7", who: "Gran", kind: "Person", payee: "Panmoor Kitchen", amount: 6.99, marketItem: "Cast iron skillet", marketCheapest: 15.99, marketMedian: 28, priceGap: -9, marketShop: "pans.example" });
    const b = fairBrief([skillet], NOW);
    expect(b.saved).toBe(0);
    expect(b.tooCheap).toEqual([{ item: "Cast iron skillet", payee: "Panmoor Kitchen", who: "Gran", amount: 6.99, wasPaid: true, goingRate: 28 }]);
    expect(b.items[0]).toMatchObject({ priceSign: "too_cheap_to_be_real", wasPaid: true });
    expect(b.items[0]!.meaning).toMatch(/fake shop/i);
    expect(b.items[0]!.meaning).toMatch(/not a saving|never a good price/i);
    expect(`${b.headline} ${b.warning}`).not.toMatch(/fair prices|good price|saved/i);
    expect(b.warning).toMatch(/fake shop/);
  });

  it("never describes a stopped, denied or waiting payment as paid", () => {
    const denied = row({ id: "p8", amount: 12, outcome: "Denied", marketItem: "Phone case", marketCheapest: 10, marketMedian: 11, priceGap: 2 });
    const b = fairBrief([earbuds, denied, lamp], NOW);
    const byItem = Object.fromEntries(b.items.map((i) => [i.item, i]));
    expect(byItem["Pro wireless earbuds 2"]).toMatchObject({ wasPaid: false, outcome: "Stopped" });
    expect(byItem["Pro wireless earbuds 2"]!.meaning).toMatch(/nothing was paid/i);
    expect(byItem["Phone case"]).toMatchObject({ wasPaid: false });
    expect(byItem["Phone case"]!.meaning).toMatch(/nothing was paid/i);
    expect(byItem["LED desk lamp"]).toMatchObject({ wasPaid: true, priceSign: "over_cheapest" });
    // overpaid only counts money that left
    expect(b.overpaid).toBe(5);
    // the stopped fake earbuds are in tooCheap, marked not paid
    expect(b.tooCheap).toEqual([expect.objectContaining({ item: "Pro wireless earbuds 2", wasPaid: false })]);
    expect(b.items.some((i) => "paid" in i)).toBe(false);
  });

  it("leaves out checks older than this month (30 days), like the fair price widget", () => {
    const old = { ...lamp, when: new Date(NOW.getTime() - 40 * DAY) };
    expect(fairBrief([old], NOW).checked).toBe(0);
  });
});

describe("today's real shop prices, worded so a loose match can't pass as the usual price", () => {
  it("leads with the cheapest real shop and says a name match can include other brands", () => {
    const t = todayLine({ item: "Steel kettle 1.7L", currency: "GBP", offers: 5, cheapest: { shop: "dunelm.com", price: 39 }, median: 97.95, shops: [{ shop: "dunelm.com", price: 39 }, { shop: "johnlewis.com", price: 90 }] });
    expect(t).toMatchObject({ item: "Steel kettle 1.7L", cheapestToday: { shop: "dunelm.com", price: 39 }, listings: 5 });
    expect(JSON.stringify(t)).not.toContain("97.95");
    expect(t.note).toMatch(/other brands|other models/i);
  });

  it("marks a failed search as unavailable, with no price, so the old figure can't stand in for today's", () => {
    const t = todayUnavailable("LED desk lamp", "Real shop price search is unavailable right now.");
    expect(t.cheapestToday).toBeNull();
    expect(t.error).toBeTruthy();
    expect(t.note).toMatch(/unavailable/i);
    expect(t.note).toMatch(/don't quote/i);
  });

  it("says no match rather than guessing a price", () => {
    const t = todayLine({ item: "Odd thing", currency: "GBP", offers: 0, cheapest: null, median: null, shops: [] });
    expect(t.cheapestToday).toBeNull();
    expect(t.note).toMatch(/no real shop/i);
  });

  // N7 / m1 (round 4): the Fair price tile said "around £169" for the sample earbuds and the assistant said
  // "about £159". The going rate is the middle real price, the same figure the tile prints, everywhere.
  it("hands the assistant the tile's going rate for every item, and words a too cheap price with it", () => {
    const b = fairBrief([lamp, kettle, earbuds], NOW);
    const buds = b.items.find((i) => i.item === "Pro wireless earbuds 2")!;
    expect(buds.goingRate).toBe(169);
    expect(buds.meaning).toContain("around £169");
    expect(buds.meaning).not.toContain("£159");
    expect(b.tooCheap[0]!.goingRate).toBe(169);
    expect(b.items.find((i) => i.item === "LED desk lamp")!.goingRate).toBe(27);
  });
});
