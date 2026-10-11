import { describe, expect, it } from "vitest";
import { claimsUsed, contradictsPrice, marketCell, marketFacts, marketSummary, priceCheck, priceVerdict, priceWatchFits, type Offer } from "./market";
import { formatMoney } from "./types";

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

describe("priced like a used one", () => {
  const cond = (price: number, condition: "new" | "used" | null, domain = `s${price}.co.uk`): Offer => ({ ...offer(price, domain), condition });
  // New ones from £679, used ones £300 to £360 (Channel3 offers carry condition since July 2026).
  const mixed = [cond(67900, "new"), cond(69900, "new"), cond(72900, null), cond(30000, "used"), cond(36000, "used"), cond(33000, "used")];

  it("flags a 'new' item that sits below every new offer but inside the used range", () => {
    const r = priceCheck(32000, "GBP", mixed);
    expect(r.likeUsed).toEqual({ newFrom: 67900, usedLow: 30000, usedHigh: 36000 });
    expect(r.flag).toMatchObject({ kind: "price", severity: "medium" });
    expect(r.flag?.why).toBe("Priced like a used one. New ones cost at least £679.00.");
    expect(priceVerdict(r)).toBe("like_used");
  });

  it("uses only new offers (and ones with no condition) for the going rate", () => {
    const r = priceCheck(69900, "GBP", mixed);
    expect(r.median).toBe(69900);
    expect(r.offers).toBe(3);
    expect(r.flag).toBeNull();
    expect(r.likeUsed).toBeUndefined();
  });

  it("says nothing when the item itself is sold as used or refurbished", () => {
    for (const item of ["Used Sony WF-1000XM5", "refurbished earbuds", "Pre-owned iPhone 13", "second hand sofa", "Renewed laptop"]) {
      expect(priceCheck(32000, "GBP", mixed, { item }).likeUsed).toBeUndefined();
    }
  });

  it("needs two offers on each side, in the payment's currency", () => {
    const oneUsed = mixed.filter((o) => o.price !== 30000 && o.price !== 33000);
    expect(priceCheck(36000, "GBP", oneUsed).likeUsed).toBeUndefined();
    const usdUsed = mixed.map((o) => (o.condition === "used" ? { ...o, currency: "USD" as const } : o));
    expect(priceCheck(32000, "GBP", usdUsed).likeUsed).toBeUndefined();
    const oneNew = [cond(67900, "new"), cond(30000, "used"), cond(36000, "used")];
    expect(priceCheck(32000, "GBP", oneNew).likeUsed).toBeUndefined();
  });

  it("stays quiet outside the used range or at a new price", () => {
    expect(priceCheck(37000, "GBP", mixed).likeUsed).toBeUndefined(); // above the used range, below new
    expect(priceCheck(67900, "GBP", mixed).likeUsed).toBeUndefined(); // the cheapest new price itself
  });

  it("keeps the fake shop flag when the price is also far below the going rate, with the used range noted", () => {
    const deep = [cond(90000, "new"), cond(95000, "new"), cond(30000, "used"), cond(36000, "used")];
    const r = priceCheck(31000, "GBP", deep);
    expect(r.flag?.severity).toBe("high");
    expect(r.likeUsed).toEqual({ newFrom: 90000, usedLow: 30000, usedHigh: 36000 });
    expect(priceVerdict(r)).toBe("too_cheap");
  });

  it("the case agent can't call a used looking price normal or dear", () => {
    expect(contradictsPrice("The price is normal for these.", "like_used")).toBe(true);
    expect(contradictsPrice("That's well over what real shops charge.", "like_used")).toBe(true);
    expect(contradictsPrice("Much cheaper than new ones.", "like_used")).toBe(false);
    const m = { ...priceCheck(32000, "GBP", mixed), item: "earbuds" };
    expect(marketFacts(m, 32000, "GBP")).toMatch(/used ones sell for £300\.00 to £360\.00/i);
  });
});

describe("claimsUsed", () => {
  it("reads used, refurbished and similar words", () => {
    expect(claimsUsed("Refurbished Apple iPhone 13")).toBe(true);
    expect(claimsUsed("ex-display sofa")).toBe(true);
    expect(claimsUsed("open box headphones")).toBe(true);
    expect(claimsUsed("Brand new, sealed")).toBe(false);
    expect(claimsUsed("Usedom travel guide")).toBe(false);
    expect(claimsUsed(undefined)).toBe(false);
  });
});

describe("one going rate per payment (the card, the reasons and Activity agree)", () => {
  // Shaped like the live GadgetBarn case: one listing far below the rest (another product), and the real ones.
  const withOutlier = [offer(1799, "odd-shop.com", "Pulse earbuds tips"), offer(7995, "a.co.uk"), offer(8499, "b.co.uk"), offer(6999, "c.co.uk"), offer(9999, "d.co.uk")];

  it("never names a listing far below the going rate as the cheapest real shop", () => {
    const r = priceCheck(24900, "GBP", withOutlier);
    expect(r.cheapest?.domain).toBe("c.co.uk");
    expect(r.flag?.why).toContain("c.co.uk sells it for £69.99");
  });

  it("gives the reasons line, the price note and the Activity cell the same numbers", () => {
    for (const amount of [1999, 24900, 8000]) {
      const m = { ...priceCheck(amount, "GBP", withOutlier), item: "Pulse earbuds" };
      const s = marketSummary(m);
      expect(s).not.toBeNull();
      const cell = marketCell(m, "GBP");
      expect(cell).toContain(formatMoney({ amount: s!.median, currency: "GBP" }));
      expect(cell).toContain(formatMoney({ amount: s!.cheapest!.price, currency: "GBP" }));
      if (m.flag?.severity === "high") expect(m.flag.why).toContain(`around ${formatMoney({ amount: s!.median, currency: "GBP" })}`);
      if (m.flag?.severity === "medium") expect(m.flag.why).toContain(formatMoney({ amount: s!.cheapest!.price, currency: "GBP" }));
    }
  });

  it("drops a saved cheapest listing that is far below the going rate (rows saved before this rule)", () => {
    const old = { flag: null, median: 7995, offers: 5, cheapest: offer(1799, "odd-shop.com"), item: "Pulse earbuds" };
    expect(marketSummary(old)).toEqual({ median: 7995, offers: 5, cheapest: null });
    expect(marketCell(old, "GBP")).toBe("around £79.95");
  });

  it("says nothing without a going rate", () => {
    expect(marketSummary(null)).toBeNull();
    expect(marketCell({ flag: null, offers: 1, item: "x" }, "GBP")).toBe("");
  });
});

describe("priceWatchFits (Watch the price only where it makes sense)", () => {
  const base = {
    status: "needs_approval",
    amount: 24900,
    request: { item: "noise cancelling wireless earbuds" },
    ai: { flags: [] as Array<{ kind: string; severity: string }> },
    market: { ...priceCheck(24900, "GBP", market), item: "earbuds" },
  };

  it("is offered on a held payment that costs more than real shops charge", () => {
    expect(priceWatchFits(base)).toBe(true);
  });

  it("is not offered on a price far below real shops (a fake shop)", () => {
    expect(priceWatchFits({ ...base, amount: 2499, market: { ...priceCheck(2499, "GBP", market), item: "earbuds" } })).toBe(false);
  });

  it("is not offered when the shop hid instructions for AI agents", () => {
    expect(priceWatchFits({ ...base, ai: { flags: [{ kind: "prompt_injection", severity: "high" }] } })).toBe(false);
  });

  it("is not offered when the case file found hidden orders (GadgetBarn) or called it a likely scam", () => {
    expect(priceWatchFits({ ...base, case_file: { verdict: "unclear", findings: [{ kind: "prompt_injection" }] } })).toBe(false);
    expect(priceWatchFits({ ...base, case_file: { verdict: "likely_scam", findings: [] } })).toBe(false);
    expect(priceWatchFits({ ...base, case_file: { verdict: "unclear", findings: [{}] } })).toBe(true);
  });

  it("is not offered when the ask is already at or under the cheapest real shop", () => {
    expect(priceWatchFits({ ...base, amount: 16999, market: { ...priceCheck(16999, "GBP", market), item: "earbuds" } })).toBe(false);
  });

  it("needs a product, a known going rate and a held, denied or stopped payment", () => {
    expect(priceWatchFits({ ...base, request: {} })).toBe(false);
    expect(priceWatchFits({ ...base, market: null })).toBe(false);
    expect(priceWatchFits({ ...base, status: "captured" })).toBe(false);
  });
});
