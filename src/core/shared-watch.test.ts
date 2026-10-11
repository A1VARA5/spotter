import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender } from "./lifecycle";
import type { PriceHistory, Product } from "@/market/channel3";
import { DEMO_SHARED_WATCH, SHARED_WATCH_LABEL, sharedWatch, sharedWatchFor, type SharedC3 } from "./shared-watch";
import { runWatches, startWatch, stopWatch, type WatchC3 } from "./watch";

const P = DEMO_SHARED_WATCH.productId;
const hist = (points: Array<[string, number, string]>, current: PriceHistory["current"] = null): PriceHistory => ({
  title: "Sony WH-1000XM5 Noise Cancelling Wireless Bluetooth Headphones",
  points: points.map(([at, price, currency]) => ({ at, price, currency })),
  current,
});

let db: Db;
let c3: { start: ReturnType<typeof vi.fn>; history: ReturnType<typeof vi.fn>; product: ReturnType<typeof vi.fn> };
const deps = () => ({ db, c3: c3 as unknown as SharedC3 });
const rows = async () => db.query<{ n: string }>("select count(*)::text as n from shared_watches").then((r) => Number(r[0]!.n));
const ago = (minutes: number) => db.query("update shared_watches set tried_at = now() - make_interval(mins => $1)", [minutes]);

beforeEach(async () => {
  db = await pgliteDb();
  c3 = {
    start: vi.fn(async () => "active"),
    product: vi.fn(async () => null),
    history: vi.fn(async () =>
      hist(
        [
          ["2026-10-09T09:00:00Z", 22900, "GBP"],
          ["2026-10-10T09:00:00Z", 19900, "GBP"],
          ["2026-10-10T09:00:00Z", 21900, "USD"],
        ],
        { price: 19900, currency: "GBP", status: "low" },
      ),
    ),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the shared demo price watch", () => {
  it("is created on first use: one row, Channel3 tracking started once, its real history in the family's currency", async () => {
    const v = await sharedWatch(deps(), "hourly");
    expect(await rows()).toBe(1);
    expect(c3.start).toHaveBeenCalledTimes(1);
    expect(c3.start).toHaveBeenCalledWith(P);
    expect(c3.history).toHaveBeenCalledTimes(1);
    expect(v.label).toBe(SHARED_WATCH_LABEL);
    expect(v.productId).toBe(P);
    expect(v.trackingSince).not.toBeNull();
    expect(v.points).toEqual([
      { at: "2026-10-09T09:00:00.000Z", price: 22900 },
      { at: "2026-10-10T09:00:00.000Z", price: 19900 },
    ]);
    expect(v.status).toBe("low");
    expect(v.lastCheckedAt).not.toBeNull();
    expect(v.unreachableAt).toBeNull();
    expect(v.checked).toBe("now");
    expect((await sharedWatch(deps(), "hourly")).checked).toBe("cached");
  });

  it("stores the Channel3 product id it tracks, so the subscription is never started again per family", async () => {
    await sharedWatch(deps(), "hourly");
    const [r] = await db.query<{ product_id: string; tracking_since: string | null }>("select product_id, tracking_since from shared_watches where key = 'demo'");
    expect(r!.product_id).toBe(P);
    expect(r!.tracking_since).not.toBeNull();
  });

  it("starts tracking only once even when many demo families open the panel at the same moment", async () => {
    const views = await Promise.all(Array.from({ length: 6 }, () => sharedWatch(deps(), "hourly")));
    // The ones that didn't make the calls wait for the one that did, instead of showing "not started yet".
    for (const v of views) expect(v.trackingSince).not.toBeNull();
    for (const v of views) expect(v.points).toHaveLength(2);
    expect(await rows()).toBe(1);
    expect(c3.start).toHaveBeenCalledTimes(1);
    expect(c3.history).toHaveBeenCalledTimes(1);
  });

  it("asks Channel3 at most once an hour when the panel is opened (cached in between)", async () => {
    await sharedWatch(deps(), "hourly");
    await sharedWatch(deps(), "hourly");
    await ago(59);
    await sharedWatch(deps(), "hourly");
    expect(c3.history).toHaveBeenCalledTimes(1);
    await ago(61);
    const v = await sharedWatch(deps(), "hourly");
    expect(c3.history).toHaveBeenCalledTimes(2);
    expect(c3.start).toHaveBeenCalledTimes(1);
    expect(v.points).toHaveLength(2);
  });

  it("'none' only reads what is stored and never calls Channel3", async () => {
    const v = await sharedWatch(deps(), "none");
    expect(c3.start).not.toHaveBeenCalled();
    expect(c3.history).not.toHaveBeenCalled();
    expect(v.points).toEqual([]);
    expect(v.trackingSince).toBeNull();
  });

  it("the daily job refreshes it even inside the hour, but not twice within ten minutes", async () => {
    await sharedWatch(deps(), "hourly");
    await ago(30);
    await sharedWatch(deps(), "daily");
    expect(c3.history).toHaveBeenCalledTimes(2);
    await sharedWatch(deps(), "daily");
    expect(c3.history).toHaveBeenCalledTimes(2);
  });

  it("when Channel3 is unreachable it shows the last stored history with the date it was checked", async () => {
    const first = await sharedWatch(deps(), "hourly");
    c3.history.mockResolvedValueOnce(null);
    await ago(61);
    const v = await sharedWatch(deps(), "hourly");
    expect(v.points).toEqual(first.points);
    expect(v.lastCheckedAt).toBe(first.lastCheckedAt);
    expect(v.unreachableAt).not.toBeNull();
    expect(v.checked).toBe("failed");
    // The next good answer clears it.
    await ago(61);
    expect((await sharedWatch(deps(), "hourly")).unreachableAt).toBeNull();
  });

  it("a history call that throws is treated like an outage, never as an empty history", async () => {
    const first = await sharedWatch(deps(), "hourly");
    c3.history.mockRejectedValueOnce(new Error("socket hang up"));
    await ago(61);
    const v = await sharedWatch(deps(), "hourly");
    expect(v.points).toEqual(first.points);
    expect(v.unreachableAt).not.toBeNull();
  });

  it("if Channel3 won't start tracking, nothing is shown as tracked and it tries again after an hour", async () => {
    c3.start.mockResolvedValueOnce(null);
    const v = await sharedWatch(deps(), "hourly");
    expect(v.trackingSince).toBeNull();
    expect(v.unreachableAt).not.toBeNull();
    expect(c3.history).not.toHaveBeenCalled();
    await sharedWatch(deps(), "hourly");
    expect(c3.start).toHaveBeenCalledTimes(1);
    await ago(61);
    const again = await sharedWatch(deps(), "hourly");
    expect(c3.start).toHaveBeenCalledTimes(2);
    expect(again.trackingSince).not.toBeNull();
  });

  it("never invents a price: an empty history stays empty, and a new answer keeps older points it no longer returns", async () => {
    c3.history.mockResolvedValueOnce(hist([]));
    expect((await sharedWatch(deps(), "hourly")).points).toEqual([]);
    await ago(61);
    c3.history.mockResolvedValueOnce(hist([["2026-10-01T09:00:00Z", 22900, "GBP"]]));
    await sharedWatch(deps(), "hourly");
    await ago(61);
    c3.history.mockResolvedValueOnce(hist([["2026-10-02T09:00:00Z", 21900, "GBP"]]));
    const v = await sharedWatch(deps(), "hourly");
    expect(v.points.map((p) => p.price)).toEqual([22900, 21900]);
  });
});

describe("today's prices at UK shops", () => {
  it("are read from Channel3's product listing (free), cheapest first, only genuine offers in the family's currency", async () => {
    c3.product = vi.fn(async () => ({
      id: P,
      title: "Sony WH-1000XM5",
      offers: [
        { title: "Sony WH-1000XM5", domain: "currys.co.uk", price: 22900, currency: "GBP", url: "https://currys.co.uk/p" },
        { title: "Sony WH-1000XM5", domain: "johnlewis.com", price: 19900, currency: "GBP", url: "https://johnlewis.com/p" },
      ],
    }));
    const v = await sharedWatch(deps(), "hourly");
    expect(c3.product).toHaveBeenCalledWith(P, "GBP");
    expect(v.shops.map((s) => [s.shop, s.price])).toEqual([
      ["johnlewis.com", 19900],
      ["currys.co.uk", 22900],
    ]);
  });

  it("keep the last ones when the product listing doesn't answer, without hiding the history", async () => {
    c3.product = vi.fn(async () => ({ id: P, title: "x", offers: [{ title: "x", domain: "johnlewis.com", price: 19900, currency: "GBP", url: "https://johnlewis.com/p" }] }));
    await sharedWatch(deps(), "hourly");
    c3.product = vi.fn(async () => null);
    await ago(61);
    const v = await sharedWatch(deps(), "hourly");
    expect(v.shops).toHaveLength(1);
    expect(v.points).toHaveLength(2);
    expect(v.unreachableAt).toBeNull();
  });

  it("carry the date they were really read, not the date of a later history check", async () => {
    c3.product = vi.fn(async () => ({ id: P, title: "x", offers: [{ title: "x", domain: "johnlewis.com", price: 19900, currency: "GBP", url: "https://johnlewis.com/p" }] }));
    const first = await sharedWatch(deps(), "hourly");
    expect(first.shopsCheckedAt).toBe(first.lastCheckedAt);
    await db.query("update shared_watches set shops_checked_at = now() - interval '3 days', last_checked_at = now() - interval '3 days'");
    c3.product = vi.fn(async () => null);
    await ago(61);
    const v = await sharedWatch(deps(), "hourly");
    expect(Date.parse(v.lastCheckedAt!) - Date.parse(v.shopsCheckedAt!)).toBeGreaterThan(2 * 86_400_000);
  });
});

describe("saying what went wrong", () => {
  it("a product Channel3 can't track is named as that, not as Channel3 being down", async () => {
    c3.start.mockResolvedValueOnce("not_found");
    const v = await sharedWatch(deps(), "hourly");
    expect(v.problem).toBe("not_found");
    c3.start.mockResolvedValueOnce(null);
    await ago(61);
    expect((await sharedWatch(deps(), "hourly")).problem).toBe("unreachable");
    await ago(61);
    expect((await sharedWatch(deps(), "hourly")).problem).toBeNull();
  });

  it("logs when Channel3 answered only in another currency, so a history that stops growing is noticed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    c3.history.mockResolvedValueOnce(hist([["2026-10-10T09:00:00Z", 26900, "USD"]]));
    await sharedWatch(deps(), "hourly");
    expect(warn).toHaveBeenCalled();
  });
});

describe("price watches next to the shared one", () => {
  it("a family stopping its own watch on the same product never stops the shared Channel3 tracking", async () => {
    await sharedWatch(deps(), "hourly");
    const hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
    const allowance = { weekly: { amount: 40000, currency: "GBP" as const }, askAbove: { amount: 5000, currency: "GBP" as const }, blockedCategories: [], allowedPayees: [], blockedPayees: [] };
    await createSpender(db, { householdId: hh, id: "gran", name: "Gran", kind: "person", spotterName: "Sam", allowance });
    const product: Product = {
      id: P,
      title: "Sony WH-1000XM5 Noise Cancelling Wireless Bluetooth Headphones",
      offers: [
        { title: "Sony WH-1000XM5", domain: "johnlewis.com", price: 19900, currency: "GBP", url: "https://johnlewis.com/p" },
        { title: "Sony WH-1000XM5", domain: "currys.co.uk", price: 22900, currency: "GBP", url: "https://currys.co.uk/p" },
      ],
    };
    const wc3 = {
      search: vi.fn(async () => [product]),
      start: vi.fn(async () => "active"),
      stop: vi.fn(async () => true),
      history: vi.fn(async () => hist([])),
      product: vi.fn(async () => product),
    };
    const wdeps = { db, c3: wc3 as unknown as WatchC3 };
    const started = await startWatch(wdeps, { householdId: hh, item: "Sony WH-1000XM5 Noise Cancelling Wireless Bluetooth Headphones", currency: "GBP", nearly: 24900, createdBy: "spotter" });
    expect("watch" in started).toBe(true);
    if (!("watch" in started)) return;
    await stopWatch(wdeps, hh, started.watch.id);
    await runWatches(wdeps);
    expect(wc3.stop).not.toHaveBeenCalled();
    expect(await rows()).toBe(1);
  });
});

describe("who sees the shared watch", () => {
  it("demo families see it (and opening it refreshes hourly); real families don't, and never cost a Channel3 call", async () => {
    const demo = (await createHousehold(db, { name: "D", spotterName: "Sam", demo: true })).id;
    const real = (await createHousehold(db, { name: "R", spotterName: "Sam" })).id;
    expect(await sharedWatchFor(deps(), real)).toBeNull();
    expect(await sharedWatchFor(deps(), "hh_missing")).toBeNull();
    expect(c3.start).not.toHaveBeenCalled();
    const v = await sharedWatchFor(deps(), demo);
    expect(v?.label).toBe(SHARED_WATCH_LABEL);
    expect(c3.start).toHaveBeenCalledTimes(1);
  });
});
