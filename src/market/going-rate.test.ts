// One going rate per payment, from UK shops for a GBP payment, one price per shop, same kind of product.
// Replays a recorded Channel3 answer (POST /v1/search "cast iron skillet", GB/GBP, 11 Oct 2026): no live calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { offersFor, searchProducts, sellsTo, type Product } from "./channel3";
import { marketSummary, priceCheck } from "@/core/market";

const recorded = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/c3-search-cast-iron-skillet-2026-10-11.json"), "utf8"));

async function replay(body: unknown): Promise<Product[]> {
  vi.stubEnv("CHANNEL3_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  return (await searchProducts("cast iron skillet", "GBP", 8, ["new", "used"]))!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sellsTo", () => {
  it("keeps UK and international addresses for pounds, and drops other countries' shops", () => {
    for (const d of ["dunelm.com", "currys.co.uk", "argos.co.uk", "shop.example", "brand.io", "maker.co"]) expect(sellsTo(d, "GBP")).toBe(true);
    for (const d of ["lecreuset.com.au", "lecreuset.at", "lecreuset.no", "shop.de", "store.ca", "shop.ie"]) expect(sellsTo(d, "GBP")).toBe(false);
  });

  it("does the same for dollars", () => {
    expect(sellsTo("bestshop.com", "USD")).toBe(true);
    expect(sellsTo("store.us", "USD")).toBe(true);
    expect(sellsTo("currys.co.uk", "USD")).toBe(false);
  });
});

describe("the going rate from a recorded Channel3 answer", () => {
  it("drops other countries' shops and designer pans and counts each shop once, so a £4.99 skillet is compared with about £16", async () => {
    const products = await replay(recorded);
    const offers = offersFor(products, "cast iron skillet");
    expect(offers.some((o) => /\.(au|at|no)$/.test(o.domain))).toBe(false);
    // Le Creuset at harrods (169) and hartsofstur (209) would lift the going rate of an everyday pan to £28.
    expect(offers.some((o) => o.brand === "Le Creuset")).toBe(false);
    const m = priceCheck(499, "GBP", offers, { item: "cast iron skillet" });
    // dunelm 28, debenhams 15.99, vonhaus 15.99
    expect(m.offers).toBe(3);
    expect(m.median).toBe(1599);
    expect(m.cheapest?.price).toBe(1599);
    expect(m.flag?.severity).toBe("high");
    expect(marketSummary({ ...m, item: "cast iron skillet" })).toMatchObject({ median: 1599, offers: 3 });
  });

  it("keeps the real shop's picture with its listing", async () => {
    const offers = offersFor(await replay(recorded), "cast iron skillet");
    expect(offers.find((o) => o.domain === "dunelm.com")?.image).toMatch(/^https:\/\/cdn\.trychannel3\.com\//);
  });

  it("leaves out a listing from another department (earbuds priced against a fashion shop)", async () => {
    const audio = { slug: "earbuds", path: [{ slug: "electronics" }, { slug: "audio" }, { slug: "earbuds" }] };
    const fashion = { slug: "jewellery", path: [{ slug: "apparel-accessories" }, { slug: "jewellery" }] };
    const offer = (domain: string, price: number) => ({ url: `https://buy.trychannel3.com/${domain}`, domain, price: { price, currency: "GBP" }, availability: "InStock", condition: "new" });
    const products = await replay({
      products: [
        { id: "a", title: "Wireless Earbuds Pro", category: audio, offers: [offer("audioshop.co.uk", 99)] },
        { id: "b", title: "Wireless Earbuds Pro 2nd gen", category: audio, offers: [offer("techstore.com", 109)] },
        { id: "c", title: "Wireless Earbuds Pro charm", category: fashion, offers: [offer("fashionhouse.com", 116.98)] },
      ],
    });
    expect(offersFor(products, "Wireless Earbuds Pro").map((o) => o.domain).sort()).toEqual(["audioshop.co.uk", "techstore.com"]);
  });
});
