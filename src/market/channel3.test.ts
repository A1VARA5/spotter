import { describe, expect, it } from "vitest";
import { offersFor, sameProduct, type Product } from "./channel3";

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
