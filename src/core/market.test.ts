import { describe, expect, it } from "vitest";
import { contradictsPrice, marketFacts, priceCheck, priceVerdict, type Offer } from "./market";

const offer = (price: number, domain = "currys.co.uk", title = "Sony WF-1000XM5"): Offer => ({
  title,
  brand: "Sony",
  domain,
  price,
  currency: "GBP",
  url: `https://buy.example/${domain}`,
});

const market = [offer(17900), offer(18900, "argos.co.uk"), offer(16999, "amazon.co.uk"), offer(19900, "johnlewis.com")];

describe("priceCheck", () => {
  it("stops a price that is far too good to be true", () => {
    const r = priceCheck(1999, "GBP", market);
    expect(r.flag?.kind).toBe("price");
    expect(r.flag?.severity).toBe("high");
    expect(r.flag?.why).toMatch(/£19\.99/);
    expect(r.flag?.why).toMatch(/£1(7|8)\d\.\d\d/);
  });

  it("asks when paying well over the going rate and names the cheapest shop", () => {
    const r = priceCheck(24900, "GBP", market);
    expect(r.flag?.severity).toBe("medium");
    expect(r.flag?.why).toMatch(/amazon\.co\.uk/);
    expect(r.cheapest?.domain).toBe("amazon.co.uk");
  });

  it("says nothing for a normal price", () => {
    expect(priceCheck(17900, "GBP", market).flag).toBeNull();
  });

  it("needs at least two offers before judging, and ignores other currencies", () => {
    expect(priceCheck(100, "GBP", [offer(17900)]).flag).toBeNull();
    expect(priceCheck(100, "GBP", market.map((o) => ({ ...o, currency: "USD" as const }))).flag).toBeNull();
  });

  it("uses the median so one odd listing can't skew it", () => {
    const withOutlier = [...market, offer(2000, "weird.shop")];
    expect(priceCheck(17900, "GBP", withOutlier).flag).toBeNull();
  });

  it("reports the market median and offer count it used", () => {
    const r = priceCheck(17900, "GBP", market);
    expect(r.median).toBe(18400);
    expect(r.offers).toBe(4);
  });
});

describe("priceVerdict and contradictsPrice", () => {
  it("reads the verdict from Spotter's own market result", () => {
    expect(priceVerdict(priceCheck(24900, "GBP", market))).toBe("overpriced");
    expect(priceVerdict(priceCheck(2499, "GBP", market))).toBe("too_cheap");
    expect(priceVerdict(priceCheck(17999, "GBP", market))).toBe("normal");
    expect(priceVerdict(priceCheck(17999, "GBP", [offer(17900)]))).toBeNull();
    expect(priceVerdict(null)).toBeNull();
  });

  it("spots a sentence claiming a normal price when the market says otherwise", () => {
    for (const t of ["The earbuds are at a normal price.", "The price looks fair for these.", "Priced in line with other shops.", "£249 is a reasonable price."]) {
      expect(contradictsPrice(t, "overpriced")).toBe(true);
      expect(contradictsPrice(t, "too_cheap")).toBe(true);
      expect(contradictsPrice(t, "normal")).toBe(false);
    }
  });

  it("and the other way round: overpriced or too cheap claims against a normal market", () => {
    expect(contradictsPrice("That's well over what real shops charge.", "normal")).toBe(true);
    expect(contradictsPrice("Suspiciously cheap for brand new earbuds.", "normal")).toBe(true);
    expect(contradictsPrice("Suspiciously cheap for brand new earbuds.", "overpriced")).toBe(true);
    expect(contradictsPrice("That's well over what real shops charge.", "too_cheap")).toBe(true);
    expect(contradictsPrice("That's well over what real shops charge.", "overpriced")).toBe(false);
  });

  it("leaves sentences that aren't about the price alone", () => {
    expect(contradictsPrice("The shop opened last week and has no reviews.", "overpriced")).toBe(false);
    expect(contradictsPrice("Gran has paid this pharmacy 4 times before.", "normal")).toBe(false);
    expect(contradictsPrice("anything", null)).toBe(false);
  });

  it("writes the market result as plain facts for the case agent", () => {
    const m = { ...priceCheck(24900, "GBP", market), item: "earbuds" };
    const f = marketFacts(m, 24900, "GBP")!;
    expect(f).toMatch(/earbuds/);
    expect(f).toMatch(/£249\.00/);
    expect(f).toMatch(/overpriced/i);
    expect(f).toMatch(/4 retailers/);
    expect(marketFacts(null, 24900, "GBP")).toBeNull();
  });
});
