import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import type { Product } from "./channel3";
import { parseWas, spotTheDifference, type SpotDeps, type SpotInput } from "./lookalike";

const jpeg = (bytes = 2000) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes, 7)]).toString("base64")}`;

const product = (id: string, title: string, offers: Array<[string, number]>, currency: "GBP" | "USD" = "GBP"): Product => ({
  id,
  title,
  image: `https://cdn.trychannel3.com/${id}`,
  offers: offers.map(([domain, price]) => ({ title, domain, price, currency, url: `https://buy.trychannel3.com/${id}-${domain}` })),
});

// Shaped like real image search answers: look-alikes, most of them not the same product.
const PRODUCTS = [
  product("p1", "Pixel Buds 2a", [["johnlewis.com", 12900]]),
  product("p2", "Aurora X2 wireless earbuds", [["currys.co.uk", 4999], ["argos.co.uk", 4800]]),
  product("p3", "Aurora X2 wireless earbuds charging case", [["cheap.example", 900]]),
  product("p4", "Aurora X2 Wireless Earbuds, Black", [["johnlewis.com", 4999]]),
];

let db: Db;
let hh: string;
let search: ReturnType<typeof vi.fn<SpotDeps["imageSearch"]>>;
let deps: SpotDeps;

const input = (over: Partial<SpotInput> = {}): SpotInput => ({
  paymentId: "pay_1",
  item: "Aurora X2 wireless earbuds",
  amount: 1999,
  currency: "GBP",
  payee: "GadgetBarn",
  reason: "fake shop price",
  page: { finalUrl: "https://gadgetbarn.shop/pulse", screenshot: jpeg() },
  ...over,
});

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
  search = vi.fn<SpotDeps["imageSearch"]>(async () => PRODUCTS);
  deps = { db, householdId: hh, imageSearch: search };
});

describe("spotTheDifference", () => {
  it("leads with one number, one verdict line and up to 3 differences, from verified matches only", async () => {
    const s = await spotTheDifference(deps, input());
    expect(s).not.toBeNull();
    expect(s!.typical).toBe(4999); // median of the three matching offers (4800, 4999, 4999); the accessory and other buds are left out
    expect(s!.offers).toBe(3);
    expect(s!.direction).toBe("cheaper");
    expect(s!.headline).toBe("£19.99 here, about £49.99 at real shops");
    expect(s!.verdict).toMatch(/fake shop tell/);
    expect(s!.genuine).toMatchObject({ domain: "argos.co.uk", price: 4800, image: "https://cdn.trychannel3.com/p2" });
    expect(s!.differences.map((d) => d.label)).toEqual(["Price", "Web address", "Seller"]);
    expect(s!.differences[1]).toEqual({ label: "Web address", here: "gadgetbarn.shop", real: "argos.co.uk" });
    // Sent the screenshot bytes (no data URL prefix).
    expect(search.mock.calls[0]![0]).toEqual({ base64: jpeg().split(",")[1] });
  });

  it("says the direction right for a shop that charges too much", async () => {
    const s = await spotTheDifference(deps, input({ amount: 9999, reason: "brand new shop" }));
    expect(s!.direction).toBe("dearer");
    expect(s!.verdict).toMatch(/for less/);
  });

  it("shows nothing when no result is the same product (a wrong match looks broken)", async () => {
    expect(await spotTheDifference(deps, input({ item: "Pulse wireless earbuds" }))).toBeNull();
    search.mockResolvedValueOnce([product("x", "Totally different earbuds", [["currys.co.uk", 5000]])]);
    expect(await spotTheDifference(deps, input({ item: "Aurora X2 wireless earbuds 2" }))).toBeNull();
  });

  it("shows nothing when Channel3 is down, and caches nothing", async () => {
    search.mockResolvedValueOnce(null);
    expect(await spotTheDifference(deps, input())).toBeNull();
    expect(await db.query("select 1 from image_search_cache")).toHaveLength(0);
  });

  it("only runs for shop reasons, with an item and a picture", async () => {
    expect(await spotTheDifference(deps, input({ reason: null }))).toBeNull();
    expect(await spotTheDifference(deps, input({ item: undefined }))).toBeNull();
    expect(await spotTheDifference(deps, input({ page: { finalUrl: "https://x.shop/" } }))).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("refuses screenshots that aren't images or are huge, without searching", async () => {
    const notImage = `data:image/jpeg;base64,${Buffer.from("<html>not an image</html>").toString("base64")}`;
    expect(await spotTheDifference(deps, input({ page: { finalUrl: "https://x.shop/", screenshot: notImage } }))).toBeNull();
    expect(await spotTheDifference(deps, input({ page: { finalUrl: "https://x.shop/", screenshot: jpeg(3_000_000) } }))).toBeNull();
    expect(await spotTheDifference(deps, input({ page: { finalUrl: "https://x.shop/", screenshot: "data:text/html;base64,PGh0bWw+" } }))).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("falls back to the product image link, https and public only", async () => {
    await spotTheDifference(deps, input({ page: { finalUrl: "https://x.shop/", productImage: "https://x.shop/img/pulse.jpg" } }));
    expect(search.mock.calls[0]![0]).toEqual({ url: "https://x.shop/img/pulse.jpg" });
    search.mockClear();
    for (const bad of ["http://x.shop/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "javascript:alert(1)", "https://10.0.0.5/a.jpg"]) {
      expect(await spotTheDifference(deps, input({ page: { finalUrl: "https://x.shop/", productImage: bad } }))).toBeNull();
    }
    expect(search).not.toHaveBeenCalled();
  });

  it("caches by picture: the same screenshot costs one search and no second credit", async () => {
    await spotTheDifference(deps, input());
    await spotTheDifference(deps, input({ paymentId: "pay_2" }));
    expect(search).toHaveBeenCalledTimes(1);
    expect(await db.query("select 1 from image_checks")).toHaveLength(1);
  });

  it("caps image searches per family per day", async () => {
    deps.perHousehold = 1;
    expect(await spotTheDifference(deps, input())).not.toBeNull();
    expect(await spotTheDifference(deps, input({ page: { finalUrl: "https://x.shop/", screenshot: jpeg(3000) } }))).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("takes retailer names only from live data, never the shop's own words", async () => {
    search.mockResolvedValueOnce([
      product("a", "Aurora X2 wireless earbuds", [["<b>Official Store</b>", 4999], ["gadgetbarn.shop", 4999], ["currys.co.uk", 4999]]),
    ]);
    const s = await spotTheDifference(deps, input());
    expect(s!.genuine.domain).toBe("currys.co.uk");
    expect(s!.offers).toBe(1);
    expect(s!.headline).toBe("£19.99 here, £49.99 at currys.co.uk");
  });

  it("reuses the safer option Spotter already offered when it is the same product", async () => {
    await db.query("insert into spenders (id, household_id, name, kind, spotter_name, allowance) values ('ag', $1, 'Agent', 'agent', 'Sam', '{}'::jsonb)", [hh]);
    await db.query("insert into payments (id, spender_id, request, status, amount, currency) values ('pay_1', 'ag', '{}'::jsonb, 'blocked', 1999, 'GBP')");
    await db.query("insert into safer_options (id, payment_id, spender_id, offer, reason) values ('offer_x', 'pay_1', 'ag', $1, 'fake shop price')", [
      JSON.stringify({ title: "Aurora X2 Wireless Earbuds, Black", domain: "johnlewis.com", price: 4999, currency: "GBP", url: "https://buy.trychannel3.com/p4-johnlewis.com" }),
    ]);
    const s = await spotTheDifference(deps, input());
    expect(s!.genuine).toMatchObject({ domain: "johnlewis.com", price: 4999, offerId: "offer_x" });
  });

  it("debunks a fake 'was' price with 30 days of real prices, only in the same currency", async () => {
    const high = vi.fn<NonNullable<SpotDeps["priceHigh"]>>(async () => ({ max: 5200, currency: "GBP", days: 30 }));
    const s = await spotTheDifference({ ...deps, priceHigh: high }, input({ page: { finalUrl: "https://gadgetbarn.shop/", screenshot: jpeg(), was: "£400.00" } }));
    expect(s!.differences[1]).toEqual({ label: "Was price", here: "Says it was £400.00", real: "No more than £52.00 at real shops in 30 days" });
    expect(s!.differences).toHaveLength(3);
    // History in another currency is skipped, and so is a was price that isn't far above the real high.
    high.mockResolvedValueOnce({ max: 5200, currency: "USD", days: 30 });
    const usd = await spotTheDifference({ ...deps, priceHigh: high }, input({ paymentId: "p3", page: { finalUrl: "https://gadgetbarn.shop/", screenshot: jpeg(), was: "£400.00" } }));
    expect(usd!.differences.map((d) => d.label)).not.toContain("Was price");
    const close = await spotTheDifference({ ...deps, priceHigh: high }, input({ paymentId: "p4", page: { finalUrl: "https://gadgetbarn.shop/", screenshot: jpeg(), was: "£55.00" } }));
    expect(close!.differences.map((d) => d.label)).not.toContain("Was price");
  });

  it("never fails the case: a broken search or history is logged and skipped", async () => {
    search.mockRejectedValueOnce(new Error("boom"));
    expect(await spotTheDifference(deps, input())).toBeNull();
    const high = vi.fn<NonNullable<SpotDeps["priceHigh"]>>(async () => Promise.reject(new Error("down")));
    const s = await spotTheDifference({ ...deps, priceHigh: high }, input({ page: { finalUrl: "https://gadgetbarn.shop/", screenshot: jpeg(), was: "£400" } }));
    expect(s).not.toBeNull();
    expect(s!.differences.map((d) => d.label)).not.toContain("Was price");
  });
});

describe("parseWas", () => {
  it("reads a struck through price in the payment's currency only", () => {
    expect(parseWas("£49.99", "GBP")).toBe(4999);
    expect(parseWas("Was £1,299", "GBP")).toBe(129900);
    expect(parseWas("$49.99", "GBP")).toBeNull();
    expect(parseWas("RRP 49.99", "GBP")).toBeNull();
    expect(parseWas("$12.50", "USD")).toBe(1250);
  });
});
