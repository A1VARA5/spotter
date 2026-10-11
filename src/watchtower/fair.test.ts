import { describe, expect, it } from "vitest";
import { LIVE_ITEMS, fairBrief, todayLine } from "./fair";
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
    expect(b.items[1]).toMatchObject({ paid: 29.99, cheapestThen: 24.99, overBy: 5, outcome: "Paid", sample: true });
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

  it("says no match rather than guessing a price", () => {
    const t = todayLine({ item: "Odd thing", currency: "GBP", offers: 0, cheapest: null, median: null, shops: [] });
    expect(t.cheapestToday).toBeNull();
    expect(t.note).toMatch(/no real shop/i);
  });
});
