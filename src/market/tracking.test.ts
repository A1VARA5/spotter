import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bestProduct, priceHistory, productOffers, startTracking, stopTracking, type Product } from "./channel3";

const KEY = "test-key-never-logged";
let fetchMock: ReturnType<typeof vi.fn>;
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("CHANNEL3_API_KEY", KEY);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = (i = 0) => fetchMock.mock.calls[i] as [string, RequestInit];

describe("startTracking", () => {
  it("posts the canonical product id and reads the subscription status (shape confirmed live 2026-10-11)", async () => {
    fetchMock.mockResolvedValue(res(200, { canonical_product_id: "VpRxZ86", subscription_status: "active", created_at: "2026-10-10T23:32:40.911430Z" }));
    expect(await startTracking("VpRxZ86")).toBe("active");
    const [url, init] = call();
    expect(url).toBe("https://api.trychannel3.com/v0/price-tracking/start");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ canonical_product_id: "VpRxZ86" });
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("says not_found for an unknown product, which is different from an outage", async () => {
    fetchMock.mockResolvedValue(res(404, { detail: "Canonical product xyz123 not found" }));
    expect(await startTracking("xyz123")).toBe("not_found");
  });

  it("returns null on an outage, out of credits or a network error, and never logs the key", async () => {
    fetchMock.mockResolvedValueOnce(res(500, { detail: "Internal Server Error" }));
    expect(await startTracking("a")).toBeNull();
    fetchMock.mockResolvedValueOnce(res(402, { detail: "You have used all of your free credits." }));
    expect(await startTracking("a")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await startTracking("a")).toBeNull();
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged).toContain("500");
    expect(logged).toContain("402");
    expect(logged).not.toContain(KEY);
  });

  it("returns null without a key and never calls out", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "");
    expect(await startTracking("a")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ")).toContain("CHANNEL3_API_KEY is not set");
  });

  it("refuses an id that isn't a plain product id, so nothing odd reaches the URL or body", async () => {
    expect(await startTracking("../v1/search")).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("stopTracking", () => {
  it("is true when stopped, and true when there was no subscription left (404)", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { canonical_product_id: "a", subscription_status: "cancelled", created_at: "x" }));
    expect(await stopTracking("a")).toBe(true);
    expect(call()[0]).toBe("https://api.trychannel3.com/v0/price-tracking/stop");
    fetchMock.mockResolvedValueOnce(res(404, { detail: "No active subscription for canonical product a" }));
    expect(await stopTracking("a")).toBe(true);
  });

  it("is null on an outage, so the caller tries again later", async () => {
    fetchMock.mockResolvedValueOnce(res(503, {}));
    expect(await stopTracking("a")).toBeNull();
  });
});

describe("priceHistory", () => {
  it("reads history and statistics in minor units (field names confirmed live: history, statistics)", async () => {
    fetchMock.mockResolvedValue(
      res(200, {
        canonical_product_id: "VpRxZ86",
        product_title: "Studio Buds",
        history: [
          { timestamp: "2026-09-11T00:00:00Z", price: 149.99, currency: "USD" },
          { timestamp: "2026-09-12T00:00:00Z", price: 69.99, currency: "USD" },
        ],
        statistics: { mean: 101.82, std_dev: 42.53, min_price: 9.9, max_price: 169.99, current_price: 69.99, current_status: "typical", currency: "USD" },
      }),
    );
    const h = await priceHistory("VpRxZ86");
    expect(call()[0]).toBe("https://api.trychannel3.com/v0/price-tracking/history/VpRxZ86?days=30");
    expect(h).toEqual({
      title: "Studio Buds",
      points: [
        { at: "2026-09-11T00:00:00Z", price: 14999, currency: "USD" },
        { at: "2026-09-12T00:00:00Z", price: 6999, currency: "USD" },
      ],
      current: { price: 6999, currency: "USD", status: "typical" },
    });
  });

  it("an empty history is data (not an outage)", async () => {
    fetchMock.mockResolvedValue(res(200, { canonical_product_id: "a" }));
    expect(await priceHistory("a")).toEqual({ title: null, points: [], current: null });
  });

  it("is null on an outage", async () => {
    fetchMock.mockResolvedValue(res(500, {}));
    expect(await priceHistory("a")).toBeNull();
  });

  it("is null (an outage, not empty history) when a 200 body can't be read", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    expect(await priceHistory("a")).toBeNull();
  });
});

describe("productOffers", () => {
  it("reads one product's offers in the family's currency from the free product endpoint", async () => {
    fetchMock.mockResolvedValue(
      res(200, {
        id: "VpRxZ86",
        title: "Studio Buds +",
        offers: [
          { url: "https://shop.example/a", domain: "shop.example", price: { price: 179, currency: "GBP" }, availability: "InStock" },
          { url: "https://gone.example/a", domain: "gone.example", price: { price: 99, currency: "GBP" }, availability: "OutOfStock" },
          { url: "https://us.example/a", domain: "us.example", price: { price: 99, currency: "USD" }, availability: "InStock" },
        ],
      }),
    );
    const p = await productOffers("VpRxZ86", "GBP");
    expect(call()[0]).toBe("https://api.trychannel3.com/v1/products/VpRxZ86?country=GB&currency=GBP");
    expect(p?.offers.map((o) => [o.domain, o.price])).toEqual([["shop.example", 17900]]);
    expect(p?.title).toBe("Studio Buds +");
  });

  it("is null on an outage", async () => {
    fetchMock.mockResolvedValue(res(500, {}));
    expect(await productOffers("a", "GBP")).toBeNull();
  });
});

describe("bestProduct", () => {
  const p = (id: string, title: string, ...prices: number[]): Product => ({
    id,
    title,
    offers: prices.map((price, i) => ({ title, domain: `shop${i}.co.uk`, price, currency: "GBP" as const, url: "https://x" })),
  });

  it("picks the one listing to watch when several match: every word of the item first, then most shops", () => {
    const products = [
      p("tips", "AirPods Pro 3 Ear Tips", 900),
      p("loose", "AirPods Pro 3 Wireless Earbuds", 21900),
      p("exact", "Apple AirPods Pro 3 Wireless Earbuds", 22999, 21999),
      p("exact-one-shop", "Apple AirPods Pro 3", 20999),
    ];
    expect(bestProduct(products, "Apple AirPods Pro 3")?.id).toBe("exact");
  });

  it("is null when no listing is the same product", () => {
    expect(bestProduct([p("max", "AirPods Max 2", 49900)], "Apple AirPods Pro 3")).toBeNull();
  });

  it("skips listings with no offer in the currency", () => {
    expect(bestProduct([p("none", "Apple AirPods Pro 3")], "Apple AirPods Pro 3")).toBeNull();
  });
});
