// R6-N3: the Fair price tile said "paid £8.50 more" right above a "far too cheap" item. One headline,
// true for the whole tile: overpaying (paid items over the cheapest real shop) and prices too cheap to be
// real (a fake shop sign, paid or not) are told apart and never summed together.
import { describe, expect, it } from "vitest";
import { fairHeadline, fairPrice, type PriceRow } from "./widgetLogic";

const NOW = new Date("2026-10-11T12:00:00Z");
let n = 0;
const pr = (over: Partial<PriceRow>): PriceRow => ({
  id: `r${n++}`,
  when: new Date(NOW.getTime() - 86_400_000),
  who: "Shopping agent",
  kind: "AI agent",
  payee: "Homeware Hub",
  amount: 20,
  outcome: "Paid",
  marketCheapest: 20,
  marketMedian: 22,
  priceGap: 0,
  marketShop: "shop.example",
  marketItem: "Steel kettle",
  sample: false,
  ...over,
});
const overRow = (gap: number) => pr({ amount: 20 + gap, priceGap: gap });
const fairRow = () => pr({});
const fakePaid = () => pr({ amount: 4.99, marketCheapest: 15.99, marketMedian: 28, priceGap: -11, marketItem: "Cast iron skillet" });
const fakeStopped = () => pr({ amount: 24.99, outcome: "Stopped", marketCheapest: 159, marketMedian: 169, priceGap: -134.01, marketItem: "Pro wireless earbuds" });

describe("the fair price headline for every mix", () => {
  it("is true for the whole tile whatever mix of overpaid, fair and too cheap items it shows", () => {
    for (const over of [0, 1, 2])
      for (const fair of [0, 1])
        for (const paidFake of [0, 1, 2])
          for (const unpaidFake of [0, 1, 2]) {
            const rows = [
              ...Array.from({ length: over }, (_, i) => overRow(i === 0 ? 5 : 3.5)),
              ...Array.from({ length: fair }, fairRow),
              ...Array.from({ length: paidFake }, fakePaid),
              ...Array.from({ length: unpaidFake }, fakeStopped),
            ];
            if (!rows.length) continue;
            const f = fairPrice(rows, NOW);
            const h = f.headline;
            const mix = `over ${over}, fair ${fair}, paid fake ${paidFake}, unpaid fake ${unpaidFake}: ${h}`;
            expect(h, mix).not.toBe("");
            // Overpaying is only ever said for items that really cost more, with their own sum.
            if (over) {
              const sum = over === 1 ? "£5" : "£8.50";
              expect(h, mix).toContain(`paid ${sum} more than the cheapest real shop${over === 1 ? "" : "s"} on ${over} item${over === 1 ? "" : "s"}`);
              expect(f.overpaid, mix).toBe(over === 1 ? 5 : 8.5);
            } else {
              expect(h, mix).not.toMatch(/paid £[\d.,]+ more than/);
              expect(f.overpaid, mix).toBe(0);
            }
            // Too cheap to be real is its own sentence, with its own count, and never folded into a sum.
            const fakes = paidFake + unpaidFake;
            if (fakes) {
              expect(h, mix).toMatch(/too cheap to be real/);
              expect(h, mix).toMatch(new RegExp(`(^|\\. )${fakes} `));
              if (paidFake && unpaidFake) expect(h, mix).toContain(`${paidFake} paid, ${unpaidFake} not paid`);
              if (over) expect(h.indexOf("too cheap"), mix).toBeGreaterThan(h.indexOf(" more than"));
            } else {
              expect(h, mix).not.toMatch(/too cheap/);
            }
            // "Fair prices" is never said next to a price too cheap to be real.
            if (fakes) expect(h, mix).not.toMatch(/fair prices/i);
            if (!over && fair && !fakes) expect(h, mix).toMatch(/paid fair prices/);
            if (!over && fair && fakes) expect(h, mix).toMatch(/paid within 50p of the cheapest real shop on everything else/);
          }
  });

  it("reads like the judge's case: £8.50 over on 2 items, the skillet paid and the earbuds stopped", () => {
    const f = fairPrice([overRow(5), overRow(3.5), fakePaid(), fakeStopped()], NOW);
    expect(f.headline).toBe("Your agent paid £8.50 more than the cheapest real shops on 2 items this month. 2 prices were too cheap to be real: 1 paid, 1 not paid");
  });

  it("words each too cheap case on its own", () => {
    const h = (o: Partial<Parameters<typeof fairHeadline>[0]>) => fairHeadline({ label: "Gran", overpaid: 0, overCount: 0, fairPaid: 0, fakePaid: 0, fakeUnpaid: 0, ...o });
    expect(h({ fakePaid: 1 })).toBe("1 paid price was too cheap to be real: check it arrives");
    expect(h({ fakePaid: 2 })).toBe("2 paid prices were too cheap to be real: check they arrive");
    expect(h({ fakeUnpaid: 1 })).toBe("1 price was too cheap to be real, and nothing was paid for it");
    expect(h({ fakeUnpaid: 2 })).toBe("2 prices were too cheap to be real, and nothing was paid for them");
    expect(h({ fairPaid: 1, fakePaid: 1 })).toBe("Gran paid within 50p of the cheapest real shop on everything else this month. 1 paid price was too cheap to be real: check it arrives");
    expect(h({})).toBe("Nothing paid this month had a price check yet");
  });

  it("doesn't count a few pence over as overpaying in the sum or the item count", () => {
    const f = fairPrice([overRow(5), pr({ amount: 20.3, priceGap: 0.3 })], NOW);
    expect(f.overpaid).toBe(5);
    expect(f.headline).toBe("Your agent paid £5 more than the cheapest real shop on 1 item this month");
  });
});
