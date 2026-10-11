import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender } from "./lifecycle";
import type { Offer } from "./market";
import type { PriceHistory, Product } from "@/market/channel3";
import {
  checkWatch,
  createExampleWatch,
  genuineOffers,
  hintFromWebhook,
  listWatches,
  mergeHistory,
  runWatches,
  startWatch,
  stopWatch,
  targetPrice,
  watchFromPayment,
  type WatchC3,
  type WatchDeps,
  type WatchView,
} from "./watch";

const allowance = { weekly: { amount: 40000, currency: "GBP" as const }, askAbove: { amount: 5000, currency: "GBP" as const }, blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const offer = (domain: string, price: number, title = "Over ear wireless headphones X2"): Offer => ({ title, domain, price, currency: "GBP", url: `https://${domain}/p` });
const product = (id: string, prices: Array<[string, number]>, title = "Over ear wireless headphones X2"): Product => ({ id, title, offers: prices.map(([d, p]) => offer(d, p, title)) });
const history = (points: Array<[string, number, string]> = []): PriceHistory => ({ title: "X2", points: points.map(([at, price, currency]) => ({ at, price, currency })), current: null });

let db: Db;
let hh: string;
let c3: { [K in keyof WatchC3]: ReturnType<typeof vi.fn> };
let notify: ReturnType<typeof vi.fn<(w: WatchView & { householdId: string }) => Promise<void>>>;
let deps: WatchDeps;
let shopNow: Array<[string, number]>;

async function payment(id: string, status: string, amount: number, item?: string, spender = "gran") {
  const request = { id, spenderId: spender, money: { amount, currency: "GBP" }, payee: { name: "pricey-shop.co.uk", isNew: true }, category: "electronics", method: "paypal_order", context: "", createdAt: new Date().toISOString(), ...(item ? { item } : {}) };
  await db.query("insert into payments (id, spender_id, request, status, amount, currency) values ($1, $2, $3, $4, $5, 'GBP')", [id, spender, JSON.stringify(request), status, amount]);
}

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  await createSpender(db, { householdId: hh, id: "gran", name: "Gran", kind: "person", spotterName: "Sam", allowance });
  await createSpender(db, { householdId: hh, id: "agent", name: "Shopping agent", kind: "agent", spotterName: "Sam", allowance });
  shopNow = [["fair-audio.co.uk", 15900], ["big-shop.co.uk", 16900]];
  c3 = {
    search: vi.fn(async () => [product("X2abc", [["fair-audio.co.uk", 15900], ["big-shop.co.uk", 16900]]), product("tips", [["t.co.uk", 900]], "X2 ear tips")]),
    start: vi.fn(async () => "active"),
    stop: vi.fn(async () => true),
    history: vi.fn(async () => history()),
    product: vi.fn(async (id: string) => product(id, shopNow)),
  };
  notify = vi.fn(async () => {});
  deps = { db, c3: c3 as unknown as WatchC3, notify };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("targetPrice", () => {
  it("is a little under today's best real price, rounded down to whole pounds", () => {
    expect(targetPrice(21900, 15900)).toBe(15400);
  });

  it("is at least 10% under what they nearly paid when that's lower", () => {
    expect(targetPrice(16000, 15900)).toBe(14400);
  });

  it("ignores a fake shop price that was below every real shop", () => {
    expect(targetPrice(2499, 15900)).toBe(15400);
  });

  it("is 10% under what they nearly paid when no real price is known", () => {
    expect(targetPrice(8900, null)).toBe(8000);
  });

  it("keeps pennies for small amounts (rounds down to 10p under £20)", () => {
    expect(targetPrice(1299, 999)).toBe(960);
  });
});

describe("genuineOffers", () => {
  it("drops other currencies and prices far below the going rate", () => {
    const got = genuineOffers([offer("a.co.uk", 15900), offer("b.co.uk", 16900), offer("c.co.uk", 17900), offer("fake.shop", 1999), { ...offer("us.com", 100), currency: "USD" }], "GBP");
    expect(got.map((o) => o.domain)).toEqual(["a.co.uk", "b.co.uk", "c.co.uk"]);
  });
});

describe("mergeHistory", () => {
  it("uses Channel3's history when it has two or more points in the family's currency", () => {
    const h = mergeHistory(null, { title: null, points: [{ at: "2026-10-01T00:00:00Z", price: 17900, currency: "GBP" }, { at: "2026-10-02T00:00:00Z", price: 16900, currency: "GBP" }], current: { price: 16900, currency: "GBP", status: "low" } }, null, "GBP");
    expect(h).toEqual({ source: "channel3", points: [{ at: "2026-10-01T00:00:00Z", price: 17900 }, { at: "2026-10-02T00:00:00Z", price: 16900 }], status: "low" });
  });

  it("falls back to Spotter's own daily checks when Channel3's history is in another currency, one point per day", () => {
    const usd = history([["2026-10-01T00:00:00Z", 14999, "USD"], ["2026-10-02T00:00:00Z", 6999, "USD"]]);
    let h = mergeHistory(null, usd, { at: "2026-10-10T08:00:00Z", price: 15900 }, "GBP");
    h = mergeHistory(h, usd, { at: "2026-10-10T20:00:00Z", price: 15800 }, "GBP");
    h = mergeHistory(h, null, { at: "2026-10-11T08:00:00Z", price: 15500 }, "GBP");
    expect(h).toEqual({ source: "checks", points: [{ at: "2026-10-10T20:00:00Z", price: 15800 }, { at: "2026-10-11T08:00:00Z", price: 15500 }] });
  });
});

describe("startWatch", () => {
  it("watches the best matching Channel3 product with a fair target and asks Channel3 to track it", async () => {
    const r = await startWatch(deps, { householdId: hh, spenderId: "gran", item: "Over ear wireless headphones X2", currency: "GBP", nearly: 21900, createdBy: "spotter" });
    if (!("watch" in r)) throw new Error(r.error);
    expect(c3.start).toHaveBeenCalledWith("X2abc");
    expect(r.watch).toMatchObject({ status: "watching", target: 15400, nearlyPaid: 21900, who: "Gran", best: { price: 15900, shop: "fair-audio.co.uk" } });
    const days = (new Date(r.watch.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it("says plainly when Channel3 can't be reached, and never mistakes that for no product", async () => {
    c3.search.mockResolvedValueOnce(null);
    expect(await startWatch(deps, { householdId: hh, item: "X2 headphones", currency: "GBP", nearly: 21900, createdBy: "spotter" })).toMatchObject({ status: 502 });
    c3.search.mockResolvedValueOnce([]);
    expect(await startWatch(deps, { householdId: hh, item: "X2 headphones", currency: "GBP", nearly: 21900, createdBy: "spotter" })).toMatchObject({ status: 404 });
    expect(c3.start).not.toHaveBeenCalled();
  });

  it("gives back the same watch when the product is already watched, without a second subscription", async () => {
    const a = await startWatch(deps, { householdId: hh, item: "Over ear wireless headphones X2", currency: "GBP", nearly: 21900, createdBy: "spotter" });
    const b = await startWatch(deps, { householdId: hh, item: "Over ear wireless headphones X2", currency: "GBP", nearly: 21900, createdBy: "spotter" });
    expect("watch" in a && "watch" in b && a.watch.id === b.watch.id).toBe(true);
    expect(c3.start).toHaveBeenCalledTimes(1);
  });

  it("caps a family at 5 watches before any Channel3 call", async () => {
    for (let i = 0; i < 5; i++) {
      c3.search.mockResolvedValueOnce([product(`p${i}`, [["a.co.uk", 1000 + i]], `Thing ${i}`)]);
      expect("watch" in (await startWatch(deps, { householdId: hh, item: `Thing ${i}`, currency: "GBP", nearly: 2000, createdBy: "spotter" }))).toBe(true);
    }
    c3.search.mockClear();
    expect(await startWatch(deps, { householdId: hh, item: "Thing 9", currency: "GBP", nearly: 2000, createdBy: "spotter" })).toMatchObject({ status: 429 });
    expect(c3.search).not.toHaveBeenCalled();
  });

  it("has a global daily cap on new watches, so credits can't run away", async () => {
    const capped = { ...deps, caps: { perHousehold: 5, active: 100, perDay: 1 } };
    expect("watch" in (await startWatch(capped, { householdId: hh, item: "Over ear wireless headphones X2", currency: "GBP", nearly: 21900, createdBy: "spotter" }))).toBe(true);
    const other = (await createHousehold(db, { name: "Other", spotterName: "Jo" })).id;
    expect(await startWatch(capped, { householdId: other, item: "Over ear wireless headphones X2", currency: "GBP", nearly: 21900, createdBy: "spotter" })).toMatchObject({ status: 429 });
  });

  it("doesn't save a watch when Channel3 refuses to track", async () => {
    c3.start.mockResolvedValueOnce(null);
    expect(await startWatch(deps, { householdId: hh, item: "Over ear wireless headphones X2", currency: "GBP", nearly: 21900, createdBy: "spotter" })).toMatchObject({ status: 502 });
    expect(await listWatches(db, hh)).toEqual([]);
  });
});

describe("watchFromPayment", () => {
  it("watches the item of a held, denied or stopped payment in this family", async () => {
    await payment("pay_1", "voided", 21900, "Over ear wireless headphones X2");
    const r = await watchFromPayment(deps, hh, "pay_1");
    expect("watch" in r && r.watch.paymentId).toBe("pay_1");
  });

  it("refuses a paid payment, one with no product name, and another family's payment", async () => {
    await payment("pay_paid", "captured", 21900, "X2");
    await payment("pay_noitem", "needs_approval", 25000);
    expect(await watchFromPayment(deps, hh, "pay_paid")).toMatchObject({ status: 409 });
    expect(await watchFromPayment(deps, hh, "pay_noitem")).toMatchObject({ status: 400 });
    const other = (await createHousehold(db, { name: "Other", spotterName: "Jo" })).id;
    expect(await watchFromPayment(deps, other, "pay_paid")).toMatchObject({ status: 404 });
  });
});

async function watching(nearly = 21900) {
  const r = await startWatch(deps, { householdId: hh, spenderId: "gran", item: "Over ear wireless headphones X2", currency: "GBP", nearly, createdBy: "spotter" });
  if (!("watch" in r)) throw new Error(r.error);
  return r.watch;
}

describe("checkWatch (drop detection)", () => {
  it("keeps watching while the best real price is above the target", async () => {
    const w = await watching();
    expect(await checkWatch(deps, w.id)).toBe("watching");
    expect(notify).not.toHaveBeenCalled();
  });

  it("marks a drop when a real shop is at or below the target, tells the spotter once and stops tracking", async () => {
    const w = await watching();
    shopNow = [["fair-audio.co.uk", 15900], ["cheap-real.co.uk", 14900]];
    expect(await checkWatch(deps, w.id)).toBe("dropped");
    expect(await checkWatch(deps, w.id)).toBe("skipped");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatchObject({ status: "dropped", best: { price: 14900, shop: "cheap-real.co.uk" }, saving: 7000, who: "Gran", householdId: hh });
    expect(c3.stop).toHaveBeenCalledWith("X2abc");
  });

  it("ignores a fake shop price far below the rest", async () => {
    const w = await watching();
    shopNow = [["fair-audio.co.uk", 15900], ["big-shop.co.uk", 16900], ["scam.shop", 2000]];
    expect(await checkWatch(deps, w.id)).toBe("watching");
  });

  it("changes nothing on an outage", async () => {
    const w = await watching();
    c3.product.mockResolvedValueOnce(null);
    expect(await checkWatch(deps, w.id)).toBe("unavailable");
    expect((await listWatches(db, hh))[0]).toMatchObject({ status: "watching" });
  });

  it("two checks racing on the same drop notify once", async () => {
    const w = await watching();
    shopNow = [["cheap-real.co.uk", 14900]];
    const got = await Promise.all([checkWatch(deps, w.id), checkWatch(deps, w.id)]);
    expect(got.filter((g) => g === "dropped")).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("keeps the Channel3 subscription while another family still watches the product", async () => {
    const w = await watching();
    const other = (await createHousehold(db, { name: "Other", spotterName: "Jo" })).id;
    await startWatch(deps, { householdId: other, item: "Over ear wireless headphones X2", currency: "GBP", nearly: 30000, createdBy: "spotter" });
    shopNow = [["cheap-real.co.uk", 14900]];
    expect(await checkWatch(deps, w.id)).toBe("dropped");
    expect(c3.stop).not.toHaveBeenCalled();
  });
});

describe("failure paths", () => {
  it("still tells the spotter when stopping the Channel3 subscription throws after a drop", async () => {
    const w = await watching();
    shopNow = [["cheap-real.co.uk", 14900]];
    c3.stop.mockRejectedValueOnce(new Error("network"));
    await db.query("select 1");
    expect(await checkWatch(deps, w.id)).toBe("dropped");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("keeps Channel3's history line when the history call is down", async () => {
    c3.history.mockResolvedValueOnce(history([["2026-10-01T00:00:00Z", 17900, "GBP"], ["2026-10-02T00:00:00Z", 16900, "GBP"]]));
    const w = await watching();
    c3.history.mockResolvedValueOnce(null);
    await checkWatch(deps, w.id);
    expect((await listWatches(db, hh))[0]!.history?.source).toBe("channel3");
  });

  it("clears the best price when the product read worked but no shop has it in stock", async () => {
    const w = await watching();
    shopNow = [];
    await checkWatch(deps, w.id);
    expect((await listWatches(db, hh))[0]!.best).toBeNull();
  });

  it("stops the Channel3 subscription again when saving the watch fails", async () => {
    const broken: WatchDeps = {
      ...deps,
      db: { query: async (sql: string, params?: unknown[]) => (/insert into price_watches/.test(sql) ? Promise.reject(new Error("db blip")) : db.query(sql, params)) } as Db,
    };
    await expect(startWatch(broken, { householdId: hh, item: "Over ear wireless headphones X2", currency: "GBP", nearly: 21900, createdBy: "spotter" })).rejects.toThrow("db blip");
    expect(c3.stop).toHaveBeenCalledWith("X2abc");
  });

  it("a webhook check that hits an outage doesn't count as checked, so the next delivery or the daily job tries again", async () => {
    await watching();
    c3.product.mockResolvedValueOnce(null);
    expect(await hintFromWebhook(deps, "X2abc")).toEqual(0);
    shopNow = [["cheap-real.co.uk", 14900]];
    expect(await hintFromWebhook(deps, "X2abc")).toBe(1);
  });

  it("one failing Channel3 stop doesn't stop the daily job from polling", async () => {
    const a = await watching();
    await db.query("update price_watches set status = 'stopped' where id = $1", [a.id]);
    c3.search.mockResolvedValueOnce([product("other", [["a.co.uk", 5000]], "Kettle 1.7L")]);
    await startWatch(deps, { householdId: hh, item: "Kettle 1.7L", currency: "GBP", nearly: 6000, createdBy: "spotter" });
    c3.stop.mockRejectedValueOnce(new Error("network"));
    const r = await runWatches(deps);
    expect(r.checked).toBe(1);
  });
});

describe("hintFromWebhook", () => {
  it("never trusts the webhook's price: it re-checks Channel3 and only a real offer counts", async () => {
    const w = await watching();
    // The webhook claimed a drop to £1, but Channel3's offers say £159.
    expect(await hintFromWebhook(deps, "X2abc")).toBe(1);
    expect((await listWatches(db, hh)).find((x) => x.id === w.id)).toMatchObject({ status: "watching" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("is idempotent: a repeated delivery right after doesn't check or notify again", async () => {
    await watching();
    shopNow = [["cheap-real.co.uk", 14900]];
    expect(await hintFromWebhook(deps, "X2abc")).toBe(1);
    expect(await hintFromWebhook(deps, "X2abc")).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a product nobody watches", async () => {
    expect(await hintFromWebhook(deps, "nobody")).toBe(0);
    expect(c3.product).not.toHaveBeenCalled();
  });
});

describe("stopWatch", () => {
  it("stops the family's watch and the Channel3 subscription", async () => {
    const w = await watching();
    expect(await stopWatch(deps, hh, w.id)).toMatchObject({ watch: { status: "stopped" } });
    expect(c3.stop).toHaveBeenCalledWith("X2abc");
  });

  it("can't stop another family's watch", async () => {
    const w = await watching();
    const other = (await createHousehold(db, { name: "Other", spotterName: "Jo" })).id;
    expect(await stopWatch(deps, other, w.id)).toMatchObject({ status: 404 });
  });
});

describe("runWatches (the daily job)", () => {
  it("expires watches after 14 days and stops them at Channel3", async () => {
    const w = await watching();
    await db.query("update price_watches set expires_at = now() - interval '1 minute' where id = $1", [w.id]);
    const r = await runWatches(deps);
    expect(r.expired).toBe(1);
    expect(c3.stop).toHaveBeenCalledWith("X2abc");
    expect((await listWatches(db, hh))[0]).toMatchObject({ status: "expired" });
  });

  it("polls active watches through the free product lookup, so it works without the webhook", async () => {
    await watching();
    await db.query("update price_watches set last_checked_at = now() - interval '1 day'");
    shopNow = [["cheap-real.co.uk", 14900]];
    const r = await runWatches(deps);
    expect(r).toMatchObject({ checked: 1, dropped: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("retries a Channel3 stop that failed earlier", async () => {
    const w = await watching();
    c3.stop.mockResolvedValueOnce(null);
    await stopWatch(deps, hh, w.id);
    await runWatches(deps);
    expect(c3.stop).toHaveBeenCalledTimes(2);
    const [row] = await db.query<{ tracking: boolean }>("select tracking from price_watches where id = $1", [w.id]);
    expect(row?.tracking).toBe(false);
  });

  it("stops the subscription of a deleted demo family, then forgets the watch", async () => {
    await watching();
    await db.query("delete from households where id = $1", [hh]);
    await runWatches(deps);
    expect(c3.stop).toHaveBeenCalledWith("X2abc");
    expect(await db.query("select id from price_watches")).toEqual([]);
  });

  it("never touches the example watch", async () => {
    await createExampleWatch(db, hh);
    await runWatches(deps);
    expect(c3.product).not.toHaveBeenCalled();
    expect(c3.stop).not.toHaveBeenCalled();
  });
});

describe("createExampleWatch", () => {
  it("adds one labelled example drop for Gran, with no Channel3 subscription", async () => {
    await createExampleWatch(db, hh);
    const [w] = await listWatches(db, hh);
    expect(w).toMatchObject({ example: true, status: "dropped", who: "Gran" });
    expect(w!.saving).toBeGreaterThan(0);
    expect(c3.start).not.toHaveBeenCalled();
  });
});
