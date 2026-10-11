import { afterEach, describe, expect, it, vi } from "vitest";
import { highFrom, offersFor, sameProduct, searchByImage, type Product } from "./channel3";

const p = (title: string, ...prices: number[]): Product => ({
  id: title,
  title,
  offers: prices.map((price, i) => ({ title, domain: `shop${i}.co.uk`, price, currency: "GBP" as const, url: "https://x" })),
});

// Real Channel3 results for "Apple AirPods Pro 2" (9 Oct 2026): related products, not the same one.
const airpods = [
  p("Airpods Pro 2 Ear Tips", 900),
  p("AirPods Max 2", 49900),
  p("AirPods Pro 3 Wireless Earbuds", 21900, 21900),
  p("AirPods Pro 3 Noise Cancelling USB-C Wireless Earbuds", 22999),
];

describe("sameProduct", () => {
  it("needs every model number and allows one missing word like the brand", () => {
    expect(sameProduct("Apple AirPods Pro 3", "AirPods Pro 3 Wireless Earbuds")).toBe(true);
    expect(sameProduct("Sony WF-1000XM5", "WF-1000XM5 Wireless Bluetooth Noise-Cancelling Earbuds")).toBe(true);
    expect(sameProduct("Apple AirPods Pro 2", "AirPods Pro 3 Wireless Earbuds")).toBe(false);
    expect(sameProduct("Apple AirPods Pro 3", "AirPods Max 2")).toBe(false);
  });

  it("leaves out accessories unless the item is one", () => {
    expect(sameProduct("Apple AirPods Pro 2", "Airpods Pro 2 Ear Tips")).toBe(false);
    expect(sameProduct("AirPods Pro 2 ear tips", "Airpods Pro 2 Ear Tips")).toBe(true);
  });
});

describe("offersFor", () => {
  it("pools offers only from listings of the same product", () => {
    expect(offersFor(airpods, "Apple AirPods Pro 3").map((o) => o.price)).toEqual([21900, 21900, 22999]);
  });

  it("returns nothing when no listing is the same product, so no price judgement is made", () => {
    expect(offersFor(airpods, "Apple AirPods Pro 2")).toEqual([]);
  });
});

describe("searchByImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the screenshot bytes with segment AUTO and the family's country, and reads products like text search", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "k");
    const fetchMock = vi.fn(async () =>
      Response.json({
        products: [{ id: "p1", title: "Aurora X2", brands: [{ name: "Aurora" }], images: [{ url: "https://cdn.trychannel3.com/a" }], offers: [{ url: "https://buy.trychannel3.com/x", domain: "currys.co.uk", price: { price: 49.99, currency: "GBP" }, availability: "InStock" }] }],
        next_page_token: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await searchByImage({ base64: "AAAA" }, "GBP");
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.trychannel3.com/v1/image-search");
    expect(JSON.parse(String(init.body))).toEqual({ base64_image: "AAAA", limit: 10, segment: "AUTO", config: { country: "GB", currency: "GBP" } });
    expect(out).toEqual([{ id: "p1", title: "Aurora X2", brand: "Aurora", image: "https://cdn.trychannel3.com/a", offers: [{ title: "Aurora X2", brand: "Aurora", domain: "currys.co.uk", price: 4999, currency: "GBP", url: "https://buy.trychannel3.com/x" }] }]);
  });

  it("answers null (not []) on an error status, a network failure or a body without products", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    expect(await searchByImage({ url: "https://x.shop/a.jpg" }, "GBP")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await searchByImage({ url: "https://x.shop/a.jpg" }, "GBP")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "bad" })));
    expect(await searchByImage({ url: "https://x.shop/a.jpg" }, "GBP")).toBeNull();
  });
});

describe("highFrom", () => {
  it("takes the highest price when every point is in one currency (live shape: history, not price_history)", () => {
    const h = { canonical_product_id: "x", history: [{ timestamp: "t", price: 178, currency: "USD" }, { timestamp: "t", price: 229.99, currency: "USD" }], statistics: null };
    expect(highFrom(h)).toEqual({ max: 22999, currency: "USD", days: 2 });
    expect(highFrom({ history: [] })).toBeNull();
    expect(highFrom({ history: [{ price: 1, currency: "USD" }, { price: 2, currency: "GBP" }] })).toBeNull();
    expect(highFrom({ price_history: [{ price: 1, currency: "GBP" }] })).toBeNull();
  });
});
