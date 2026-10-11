// Generic items priced against generic listings: no designer brands, no fashion shops, no premium tail lifting the
// going rate. Replays recorded Channel3 answers (POST /v1/search, GB/GBP, 11 Oct 2026): no live calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { offersFor, searchProducts, type Product } from "./channel3";
import { plausibleOffers } from "./sanity";
import { priceCheck, type Offer } from "@/core/market";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));

async function replay(body: unknown, query: string): Promise<Product[]> {
  vi.stubEnv("CHANNEL3_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  return (await searchProducts(query, "GBP", 8, ["new", "used"]))!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const offer = (domain: string, price: number, brand?: string, title = "Wireless earbuds"): Offer => ({
  title,
  ...(brand ? { brand } : {}),
  domain,
  price,
  currency: "GBP",
  url: `https://buy.example/${domain}`,
  condition: "new",
});

describe("plausibleOffers", () => {
  it("drops fashion shops for an item that isn't clothing", () => {
    const kept = plausibleOffers([offer("belkin.com", 1799), offer("debenhams.com", 3995), offer("oasisfashion.com", 3995)], "wireless earbuds");
    expect(kept.map((o) => o.domain)).toEqual(["belkin.com", "debenhams.com"]);
  });

  it("keeps fashion shops for clothing", () => {
    expect(plausibleOffers([offer("oasisfashion.com", 3995), offer("next.co.uk", 3500)], "linen summer dress")).toHaveLength(2);
  });

  it("drops designer brands the item doesn't name, and keeps them when it names them", () => {
    const offers = [offer("dunelm.com", 2800, "Dunelm"), offer("debenhams.com", 1599, "VonShef"), offer("harrods.com", 16900, "Le Creuset")];
    expect(plausibleOffers(offers, "cast iron skillet").map((o) => o.domain)).toEqual(["dunelm.com", "debenhams.com"]);
    expect(plausibleOffers(offers, "Le Creuset cast iron skillet").map((o) => o.domain)).toContain("harrods.com");
  });

  it("cuts the premium tail above a big price gap when the cheap side has at least two shops", () => {
    const offers = [offer("salter.com", 3499), offer("dunelm.com", 3800), offer("hartsofstur.com", 10900), offer("next.co.uk", 15000)];
    expect(plausibleOffers(offers, "kettle").map((o) => o.domain)).toEqual(["salter.com", "dunelm.com"]);
  });

  it("leaves a tight spread alone, and never cuts down to a single cheap shop", () => {
    const tight = [offer("a.com", 2000), offer("b.com", 2600), offer("c.com", 3100)];
    expect(plausibleOffers(tight, "kettle")).toHaveLength(3);
    const lonely = [offer("a.com", 1000), offer("b.com", 4000), offer("c.com", 4200)];
    expect(plausibleOffers(lonely, "kettle")).toHaveLength(3);
  });

  it("keeps the brand's own listings when the item names a model but not the brand (AirPods Pro, WH-1000XM5)", () => {
    const offers = [offer("currys.co.uk", 22900, "Apple", "AirPods Pro 2"), offer("argos.co.uk", 21900, "Apple", "AirPods Pro 2"), offer("cheap.example", 2500, "Generic", "Pro earbuds case")];
    expect(plausibleOffers(offers, "AirPods Pro 2").map((o) => o.domain)).toEqual(expect.arrayContaining(["currys.co.uk", "argos.co.uk"]));
    const sony = [offer("johnlewis.com", 27900, "Sony", "WH-1000XM5"), offer("currys.co.uk", 26900, "Sony", "WH-1000XM5")];
    expect(plausibleOffers(sony, "WH-1000XM5 headphones")).toHaveLength(2);
  });

  it("never leaves nothing: if every listing is a designer one, they all stay", () => {
    const all = [offer("harrods.com", 16900, "Le Creuset"), offer("hartsofstur.com", 20900, "Le Creuset")];
    expect(plausibleOffers(all, "cast iron skillet")).toHaveLength(2);
  });

  it("leaves premium items alone: a 'premium' item is meant to be compared with premium listings", () => {
    const offers = [offer("a.com", 2999), offer("b.com", 3499), offer("sony.co.uk", 24900, "Sony"), offer("bose.co.uk", 27900, "Bose")];
    expect(plausibleOffers(offers, "premium noise cancelling wireless earbuds")).toHaveLength(4);
  });
});

describe("the going rate from recorded Channel3 answers", () => {
  it("earbuds: no fashion shop and no designer pair lift the price of a generic pair", async () => {
    const offers = offersFor(await replay(fixture("c3-search-pulse-wireless-earbuds-2026-10-11.json"), "Pulse wireless earbuds"), "Pulse wireless earbuds");
    const domains = offers.map((o) => o.domain);
    expect(domains).not.toContain("oasisfashion.com");
    expect(offers.some((o) => /apple|beats|sony/i.test(o.brand ?? ""))).toBe(false);
    const m = priceCheck(1999, "GBP", offers, { item: "Pulse wireless earbuds" });
    // belkin 17.99 and debenhams 39.95 (JBL): the £104.99 gaming pair sits above a big gap and is cut.
    expect(m.median).toBe(2897);
    expect(m.offers).toBe(2);
  });

  it("kettle: two ordinary kettles set the going rate, not £150 designer ones", async () => {
    const offers = offersFor(await replay(fixture("c3-search-kettle-2026-10-11.json"), "kettle"), "kettle");
    const m = priceCheck(3000, "GBP", offers, { item: "kettle" });
    expect([...new Set(offers.map((o) => o.domain))].sort()).toEqual(["dunelm.com", "salter.com"]);
    expect(m.median).toBe(3650);
    expect(m.flag).toBeNull();
  });
});
