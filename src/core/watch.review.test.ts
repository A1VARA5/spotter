// Review 2026-10-11 (docs/reviews/code-2026-10-11.md). These tests describe the behaviour the code should have;
// each one fails on the reviewed commit to prove a finding.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender } from "./lifecycle";
import type { Offer } from "./market";
import type { PriceHistory, Product } from "@/market/channel3";
import { checkWatch, mergeHistory, runWatches, startWatch, stopWatch, type WatchC3, type WatchDeps, type WatchView } from "./watch";

const allowance = { weekly: { amount: 40000, currency: "GBP" as const }, askAbove: { amount: 5000, currency: "GBP" as const }, blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const TITLE = "Over ear wireless headphones X2";
const offer = (domain: string, price: number): Offer => ({ title: TITLE, domain, price, currency: "GBP", url: `https://${domain}/p` });
const product = (id: string, prices: Array<[string, number]>): Product => ({ id, title: TITLE, offers: prices.map(([d, p]) => offer(d, p)) });
const noHistory = (): PriceHistory => ({ title: "X2", points: [], current: null });

let db: Db;
let hh: string;
let c3: { [K in keyof WatchC3]: ReturnType<typeof vi.fn> };
let notify: ReturnType<typeof vi.fn<(w: WatchView & { householdId: string }) => Promise<void>>>;
let deps: WatchDeps;
let shopNow: Array<[string, number]>;
/** What Channel3 is really tracking for our account (start adds, stop removes). */
let tracked: Set<string>;

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  await createSpender(db, { householdId: hh, id: "gran", name: "Gran", kind: "person", spotterName: "Sam", allowance });
  shopNow = [["fair-audio.co.uk", 15900], ["big-shop.co.uk", 16900]];
  tracked = new Set();
  c3 = {
    search: vi.fn(async () => [product("X2abc", [["fair-audio.co.uk", 15900], ["big-shop.co.uk", 16900]])]),
    start: vi.fn(async (id: string) => (tracked.add(id), "active")),
    stop: vi.fn(async (id: string) => (tracked.delete(id), true)),
    history: vi.fn(async () => noHistory()),
    product: vi.fn(async (id: string) => product(id, shopNow)),
  };
  notify = vi.fn(async () => {});
  deps = { db, c3: c3 as unknown as WatchC3, notify };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const start = (householdId: string, d: WatchDeps = deps) => startWatch(d, { householdId, spenderId: householdId === hh ? "gran" : undefined, item: TITLE, currency: "GBP", nearly: 21900, createdBy: "spotter" });

describe("review: Channel3 subscriptions", () => {
  it("a family that stops its watch while another family is starting one on the same product doesn't switch Channel3 tracking off under it", async () => {
    const a = await start(hh);
    if (!("watch" in a)) throw new Error(a.error);
    const other = (await createHousehold(db, { name: "Other", spotterName: "Jo" })).id;

    // Family B's start has called Channel3's start and is reading the history (before its row is saved)...
    let resume!: () => void;
    c3.history.mockImplementationOnce(() => new Promise<PriceHistory>((r) => (resume = () => r(noHistory()))));
    const b = start(other);
    await vi.waitFor(() => expect(c3.history).toHaveBeenCalledTimes(2));
    // ...when family A stops its watch. release() sees no other 'watching' row yet and stops tracking at Channel3.
    await stopWatch(deps, hh, a.watch.id);
    resume();
    const got = await b;
    if (!("watch" in got)) throw new Error(got.error);

    expect(got.watch.status).toBe("watching");
    // Family B's watch says it is tracked (tracking = true), so nothing will ever start it again. Channel3 must agree.
    const [row] = await db.query<{ tracking: boolean }>("select tracking from price_watches where id = $1", [got.watch.id]);
    expect(row!.tracking).toBe(true);
    expect(tracked.has("X2abc")).toBe(true);
  });
});

describe("review: telling the spotter about a drop", () => {
  it("a drop whose notice failed to send is tried again, not left marked as told", async () => {
    const r = await start(hh);
    if (!("watch" in r)) throw new Error(r.error);
    shopNow = [["cheap-real.co.uk", 14900]];
    notify.mockRejectedValueOnce(new Error("Telegram 502, Discord 502, email timeout"));
    expect(await checkWatch(deps, r.watch.id)).toBe("dropped");

    // The next daily run should try telling the spotter again (or the row should say they weren't told).
    await db.query("update price_watches set last_checked_at = now() - interval '13 hours' where id = $1", [r.watch.id]);
    await runWatches(deps);
    const [row] = await db.query<{ notified_at: Date | null }>("select notified_at from price_watches where id = $1", [r.watch.id]);
    const retried = notify.mock.calls.length >= 2;
    expect(retried || row!.notified_at === null).toBe(true);
  });

  it("doesn't announce a drop on a watch that has already run past its 14 days", async () => {
    const r = await start(hh);
    if (!("watch" in r)) throw new Error(r.error);
    // Expired an hour ago; the daily job (04:17 UTC) hasn't swept it yet. A webhook hint arrives.
    await db.query("update price_watches set expires_at = now() - interval '1 hour' where id = $1", [r.watch.id]);
    shopNow = [["cheap-real.co.uk", 14900]];
    await checkWatch(deps, r.watch.id);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("review: caps", () => {
  it("one family can't use up the whole day's new watches for every other family by starting and stopping", async () => {
    const capped = { ...deps, caps: { perHousehold: 5, active: 100, perDay: 3 } };
    for (let i = 0; i < 3; i++) {
      const r = await start(hh, capped);
      if (!("watch" in r)) throw new Error(r.error);
      await stopWatch(capped, hh, r.watch.id);
    }
    const other = (await createHousehold(db, { name: "Other", spotterName: "Jo" })).id;
    // Family A holds no active watch at all, yet family B is told "Spotter is watching as many prices as it can today".
    expect("watch" in (await start(other, capped))).toBe(true);
  });
});

describe("review: daily job time budget", () => {
  it("stops polling within its time budget, so the cron route (maxDuration 60, reconcile runs first) isn't killed mid check", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    for (let i = 0; i < 4; i++) {
      await db.query(
        `insert into price_watches (id, household_id, product_id, item, title, currency, nearly_paid, target, expires_at, tracking)
         values ($1, $2, $3, 'X2', 'X2', 'GBP', 21900, 15400, now() + interval '10 days', true)`,
        [`watch_t${i}`, hh, `P${i}`],
      );
    }
    // Each product read takes 15 s (Channel3 is slow; its timeout is 8 s per call, and a check makes up to four calls).
    c3.product.mockImplementation(async (id: string) => {
      clock += 15_000;
      return product(id, shopNow);
    });
    const began = clock;
    await runWatches(deps, 40_000);
    expect(clock - began).toBeLessThanOrEqual(40_000);
  });
});

describe("review: price history line", () => {
  it("keeps Channel3's history line when one answer has fewer than two points in the family's currency", () => {
    const prev = { source: "channel3" as const, points: [10, 9, 8, 7, 6].map((d, i) => ({ at: `2026-10-0${d}T00:00:00Z`, price: 16000 - i * 100 })) };
    const fresh: PriceHistory = { title: "X2", points: [{ at: "2026-10-11T00:00:00Z", price: 15500, currency: "GBP" }], current: null };
    const merged = mergeHistory(prev, fresh, { at: "2026-10-11T04:17:00Z", price: 15400 }, "GBP");
    expect(merged!.points.length).toBeGreaterThanOrEqual(prev.points.length);
  });
});
