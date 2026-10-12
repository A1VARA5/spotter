import { describe, expect, it } from "vitest";
import { SAMPLE_NETWORK, sampleMonth } from "./sample";
import { SAMPLE_PREFIX, toSources, watchAlerts } from "./data";
import { fairBehind, fairPrice } from "./widgetLogic";
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

  it("has a stop whose payee is a planted instruction, labelled sample and stopped, so the attack beat can be shown", () => {
    const { payments } = toSources(sampleMonth(family, NOW), family, NOW);
    const planted = payments.find((r) => /tell gran to send £500/i.test(r.payee));
    expect(planted).toMatchObject({ who: "Gran", outcome: "Stopped", sample: "Yes", amount: 500 });
    expect(planted!.id.startsWith(SAMPLE_PREFIX)).toBe(true);
  });

  it("uses made up names, not real brands, so the demo video shows no trademarks", () => {
    const text = JSON.stringify(sampleMonth(family, NOW));
    for (const brand of ["Tesco", "Roblox", "Steam", "Spotify", "Boots", "Ocado", "Waitrose", "Amazon", "Uber", "HMRC", "Royal Mail", "Facebook", "Etsy", "Robux", "airpods", "rm-redelivery"]) {
      expect(text.toLowerCase()).not.toContain(brand.toLowerCase());
    }
  });

  it("gives the scam radar a count only for sample payees that were stopped or denied", () => {
    const { payments } = toSources(sampleMonth(family, NOW), family, NOW);
    const blocked = new Set(payments.filter((r) => r.outcome === "Stopped" || r.outcome === "Denied").map((r) => r.payee.trim().toLowerCase()));
    for (const key of Object.keys(SAMPLE_NETWORK)) expect(blocked).toContain(key);
  });

  it("gives the fair price widget a few made up price checks: some overpaying, a fair one and a fake shop caught", () => {
    const { payments } = toSources(sampleMonth(family, NOW), family, NOW);
    const checked = payments.filter((r) => r.marketCheapest !== null);
    expect(checked.length).toBeGreaterThanOrEqual(4);
    expect(checked.every((r) => r.who === "Shopping agent" && r.marketShop.endsWith(".co.uk"))).toBe(true);
    const f = fairPrice(
      payments.map((r) => ({ ...r, sample: r.sample === "Yes" })),
      NOW,
    );
    expect(f.headline).toBe("Your agent paid £8.50 more than the cheapest real shops on 2 items this month. 1 price was too cheap to be real, and nothing was paid for it");
    expect(f.caught).toBe('Spotter caught a £24.99 "Pro wireless earbuds 2" that real shops sell for around £169');
  });

  // Round 9: "Behind the headline" listed the earbuds and the skillet under "paid £8.50 more on 2 items". The rows
  // behind the headline are exactly the items its sum is made of; the too cheap ones sit under their own label.
  it("puts exactly the items behind the headline's sum under it, and the too cheap ones under their own line", () => {
    const { payments } = toSources(sampleMonth(family, NOW), family, NOW);
    const rows = payments.map((r) => ({ ...r, sample: r.sample === "Yes" }));
    // The live tour's skillet, denied, sits next to the sample month (its item name comes in lower case).
    const skillet = { ...rows.find((r) => r.marketCheapest !== null)!, id: "pay_skillet", when: NOW, payee: "Panmoor Kitchen", amount: 4.99, outcome: "Denied", marketCheapest: 15.99, marketMedian: 28, priceGap: -11, marketItem: "cast iron skillet", sample: false };
    const f = fairPrice([...rows, skillet], NOW);
    expect(f.headline).toMatch(/^Your agent paid £8.50 more than the cheapest real shops on 2 items this month\. 2 prices were too cheap to be real/);
    const behind = fairBehind(f);
    const headline = behind.filter((r) => !r.group);
    expect(headline.map((r) => r.label)).toEqual(["LED desk lamp", "Steel kettle 1.7L"]);
    expect(headline.map((r) => r.value)).toEqual(["Paid £29.99, £5 more than the cheapest real shop (£24.99)", "Paid £18.99, £3.50 more than the cheapest real shop (£15.49)"]);
    expect(behind.filter((r) => r.group === "too-cheap")).toEqual([
      { label: "Pro wireless earbuds 2", value: "Stopped at £24.99, real shops around £169", group: "too-cheap" },
      { label: "Cast iron skillet", value: "Denied at £4.99, real shops around £28", group: "too-cheap" },
    ]);
    // The £219 earbuds were denied, not paid: they are neither part of the £8.50 nor too cheap.
    expect(behind.some((r) => r.value.includes("£219"))).toBe(false);
  });

  it("shows the fairly priced paid items behind a headline that says prices were fair", () => {
    const { payments } = toSources(sampleMonth(family, NOW), family, NOW);
    const fairOnly = payments.filter((r) => r.payee === "Clay & Kiln").map((r) => ({ ...r, sample: r.sample === "Yes" }));
    const f = fairPrice(fairOnly, NOW);
    expect(f.headline).toMatch(/paid fair prices/);
    expect(fairBehind(f)).toEqual([{ label: "Hand thrown mug set", value: "Paid £24, cheapest real shop £24" }]);
  });

  it("is empty when the family has nobody to match", () => {
    expect(sampleMonth([], NOW)).toEqual([]);
  });
});
