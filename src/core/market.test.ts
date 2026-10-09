import { describe, expect, it } from "vitest";
import { priceCheck, type Offer } from "./market";

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
