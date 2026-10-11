import { afterEach, describe, expect, it, vi } from "vitest";
import { findProductsInImage, highFrom, offersFor, parseScene, sameProduct, searchByImage, searchProducts, type Product } from "./channel3";

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

// Trimmed from a live answer of POST /experimental/find-products-in-image (11 Oct 2026): extra fields (masks,
// gender, category_ids) and an offer with condition.
const liveThing = {
  thing: "overear headphones",
  bbox: [86, 117, 217, 253],
  category_ids: ["headphones"],
  gender: null,
  masks: null,
  matches: [
    {
      id: "5jesTFu",
      title: "WH-1000XM4C Wireless Noise Cancelling Over-Ear Headphones with USB-C",
      brands: [{ id: "b", name: "Sony" }],
      images: [{ url: "https://cdn.trychannel3.com/49aa?aid=1" }],
      category: { slug: "headphones", title: "Headphones", path: [{ slug: "electronics", title: "Electronics" }, { slug: "audio", title: "Audio" }] },
      offers: [
        { url: "https://buy.trychannel3.com/5jesTFu-a", domain: "currys.co.uk", price: { price: 219.0, compare_at_price: null, currency: "GBP" }, availability: "InStock", condition: "new", max_commission_rate: 0 },
        { url: "https://buy.trychannel3.com/5jesTFu-b", domain: "resale.example", price: { price: 120, currency: "GBP" }, availability: "InStock", condition: "used" },
        { url: "https://buy.trychannel3.com/5jesTFu-c", domain: "us.example", price: { price: 199, currency: "USD" }, availability: "InStock", condition: null },
      ],
    },
  ],
};

describe("parseScene", () => {
  it("reads things, boxes, categories and offer conditions from the live shape", () => {
    const s = parseScene({ things: [liveThing], image_size: [960, 720] }, "GBP")!;
    expect(s.size).toEqual([960, 720]);
    expect(s.things).toHaveLength(1);
    const t = s.things[0]!;
    expect(t).toMatchObject({ thing: "overear headphones", bbox: [86, 117, 217, 253], categories: ["headphones"] });
    expect(t.matches[0]).toMatchObject({ id: "5jesTFu", brand: "Sony", categories: ["headphones", "electronics", "audio"] });
    expect(t.matches[0]!.offers.map((o) => [o.price, o.condition])).toEqual([
      [21900, "new"],
      [12000, "used"],
    ]);
  });

  it("drops a box that is not four whole numbers inside the picture, but keeps the thing", () => {
    for (const bbox of [[1, 2, 3], [0, 0, 2000, 10], [50, 50, 10, 10], ["1", 2, 3, 4], null]) {
      const s = parseScene({ things: [{ ...liveThing, bbox }], image_size: [960, 720] }, "GBP")!;
      expect(s.things[0]!.bbox).toBeNull();
    }
  });

  it("answers null for anything that isn't a scene, and caps things at six", () => {
    expect(parseScene({ detail: "Upstream detection failed" }, "GBP")).toBeNull();
    expect(parseScene({ things: "x", image_size: [1, 1] }, "GBP")).toBeNull();
    expect(parseScene(null, "GBP")).toBeNull();
    const many = parseScene({ things: Array.from({ length: 9 }, () => liveThing), image_size: [960, 720] }, "GBP")!;
    expect(many.things).toHaveLength(6);
  });
});

describe("findProductsInImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks for up to 6 things with the condition filter and the family's country", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "k");
    const fetchMock = vi.fn(async () => Response.json({ things: [liveThing], image_size: [960, 720] }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await findProductsInImage("AAAA", "GBP", "used");
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.trychannel3.com/experimental/find-products-in-image");
    expect(JSON.parse(String(init.body))).toEqual({ base64_image: "AAAA", max_things: 6, limit: 10, filters: { conditions: ["used"] }, config: { country: "GB", currency: "GBP" } });
    expect(s?.things).toHaveLength(1);
  });

  it("answers null on an error status (the experimental endpoint failing), a network error or a bad body", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "Upstream detection failed" }, { status: 502 })));
    expect(await findProductsInImage("AAAA", "GBP", "new")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await findProductsInImage("AAAA", "GBP", "new")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ things: null })));
    expect(await findProductsInImage("AAAA", "GBP", "new")).toBeNull();
  });
});

describe("searchProducts conditions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("passes the conditions filter when asked and keeps each offer's condition", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "k");
    const fetchMock = vi.fn(async () => Response.json({ products: [liveThing.matches[0]] }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await searchProducts("Sony WH-1000XM4C", "GBP", 8, ["new", "used"]);
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).filters).toEqual({ conditions: ["new", "used"] });
    expect(out![0]!.offers.map((o) => o.condition)).toEqual(["new", "used"]);
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
