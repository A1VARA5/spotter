import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { SKILLET, SKILLET_IMAGE } from "./shop";
import { sameItem } from "@/market/lookalike";
import { priceCheck, type Offer } from "@/core/market";

// Titles from Channel3's live image search of this page's screenshot (800x600, like KERNEL's), 11 Oct 2026.
const LIVE_TITLES = [
  "Grill Fry Pan Cast Iron 30 cm Round",
  "Signature Cast Iron Skillet",
  "Cast Iron Mini Frying Pan",
  "Blacklock Lightweight Cast Iron Skillet",
  "Cast Iron Round Skillet",
  "Cast Iron Skillet Frying Pan",
  "Cast Iron 18cm Skillet",
  "cast iron Double Handle Skillet",
];

describe("Panmoor Kitchen demo shop (spot the difference)", () => {
  it("serves a plain page that says it's a demo, isn't indexed, and shows a real product picture", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
    const html = await res.text();
    expect(html).toContain(`<b>Demo shop.</b> ${SKILLET.shop} is made up for Spotter's demo.`);
    expect(html).toContain(`<img src="${SKILLET_IMAGE}"`);
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\/demo-shop\/skillet\.jpg">/);
  });

  it("uses item words that real listings of this pan use, so the image search finds the same thing", () => {
    expect(LIVE_TITLES.filter((title) => sameItem(SKILLET.item, { title })).length).toBeGreaterThanOrEqual(5);
  });

  it("is priced far below real shops, so Spotter stops it for a fake shop price (the reason spot the difference runs for)", () => {
    const offers: Offer[] = [5995, 7000, 1495, 12500, 12900, 20900].map((price, i) => ({ title: LIVE_TITLES[i]!, domain: `shop${i}.example`, price, currency: "GBP", url: "https://x" }));
    expect(priceCheck(499, "GBP", offers).flag?.severity).toBe("high");
  });
});
