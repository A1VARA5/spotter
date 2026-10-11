// The shared live price watch: one real product that Channel3 price tracking follows for every demo family, so a
// judge sees real tracking with real history next to the "Example, checked earlier" one, without each demo start
// buying a new subscription (1 credit per product per day). It is made on first use (one shared_watches row, the
// insert is the idempotent guard), the subscription is started once, and its history is refreshed by the daily job and
// at most once an hour when someone opens the panel. Only what Channel3 returned is stored and shown: no target, no
// "nearly paid", no drop that Channel3's own points don't show.
import type { Db } from "@/db";
import type { Currency } from "./types";
import type { WatchC3 } from "./watch";
import { genuineOffers } from "./market";

/**
 * Sony WH-1000XM5 (Channel3 canonical product nepgse3): common at UK shops and sold below its launch price, so it
 * really moves. Chosen from a live Channel3 search on 2026-10-11: johnlewis.com £199 and currys.co.uk £229.
 */
export const DEMO_SHARED_WATCH = { key: "demo", productId: "nepgse3", item: "Sony WH-1000XM5 headphones", currency: "GBP" as Currency };
export const SHARED_WATCH_LABEL = "Live: tracked by Channel3 for all demo families";

const PANEL_MINUTES = 60; // opening the panel asks Channel3 at most this often
const DAILY_QUIET_MINUTES = 10; // the daily job (or a webhook) refreshes even inside the hour, never twice in a row
const MAX_POINTS = 60;
const MAX_SHOPS = 4;

export type SharedC3 = Pick<WatchC3, "start" | "history" | "product">;
export type SharedShop = { shop: string; price: number };
export type SharedDeps = { db: Db; c3: SharedC3 };
/** "hourly": the panel was opened. "daily": the daily job or a Channel3 webhook. "none": read only, never calls Channel3. */
export type SharedRefresh = "hourly" | "daily" | "none";

export type SharedWatchView = {
  label: string;
  productId: string;
  item: string;
  title: string | null;
  currency: Currency;
  /** When Channel3 price tracking was started for it; null until it really is tracked. */
  trackingSince: string | null;
  /** Channel3's own price points in this currency, oldest first. Empty until Channel3 records one. */
  points: Array<{ at: string; price: number }>;
  status?: "low" | "typical" | "high";
  /** When Channel3 last answered with the history. */
  lastCheckedAt: string | null;
  /** Set when the latest try got no answer (the stored history is shown, with lastCheckedAt). */
  unreachableAt: string | null;
  /** Genuine offers at UK shops from the product listing at the last check, cheapest first (empty if none known). */
  shops: SharedShop[];
  /** When those shop prices were read (can be older than lastCheckedAt when the listing didn't answer). */
  shopsCheckedAt: string | null;
  /** Why the latest try failed: Channel3 can't track this product, or didn't answer. Null when it worked. */
  problem: "not_found" | "unreachable" | null;
  /** What this call did: asked Channel3 and got an answer ("now"), used the stored copy ("cached"), or got no answer ("failed"). */
  checked: "now" | "cached" | "failed";
};

type Row = {
  key: string;
  product_id: string;
  item: string;
  currency: Currency;
  title: string | null;
  tracking_since: string | Date | null;
  history: Array<{ at: string; price: number }> | null;
  shops: SharedShop[] | null;
  shops_checked_at: string | Date | null;
  last_error: string | null;
  price_status: string | null;
  last_checked_at: string | Date | null;
  tried_at: string | Date | null;
  unreachable_at: string | Date | null;
};

const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);

function toView(r: Row, checked: SharedWatchView["checked"]): SharedWatchView {
  const status = r.price_status === "low" || r.price_status === "typical" || r.price_status === "high" ? r.price_status : undefined;
  return {
    label: SHARED_WATCH_LABEL,
    productId: r.product_id,
    item: r.item,
    title: r.title,
    currency: r.currency,
    trackingSince: iso(r.tracking_since),
    points: r.history ?? [],
    ...(status ? { status } : {}),
    lastCheckedAt: iso(r.last_checked_at),
    unreachableAt: iso(r.unreachable_at),
    shops: r.shops ?? [],
    shopsCheckedAt: iso(r.shops_checked_at),
    problem: r.unreachable_at ? (r.last_error === "not_found" ? "not_found" : "unreachable") : null,
    checked,
  };
}

/** Stored points plus Channel3's new answer, one per timestamp (the new one wins), oldest first. Never adds a price. */
export function mergePoints(prev: Array<{ at: string; price: number }>, fresh: Array<{ at: string; price: number; currency: string }>, currency: Currency) {
  const byAt = new Map<string, number>();
  for (const p of prev) byAt.set(p.at, p.price);
  for (const p of fresh) {
    const t = Date.parse(p.at);
    if (p.currency !== currency || !Number.isFinite(t) || !Number.isInteger(p.price) || p.price <= 0) continue;
    byAt.set(new Date(t).toISOString(), p.price);
  }
  return [...byAt.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-MAX_POINTS)
    .map(([at, price]) => ({ at, price }));
}

const read = async (db: Db, key: string) => (await db.query<Row>("select * from shared_watches where key = $1", [key]))[0]!;

const WAIT_MS = 9_000; // a refresh is two Channel3 calls of up to 8 s each, but usually about a second
const ms = (d: string | Date | null) => (d ? new Date(d).getTime() : 0);

/**
 * The stored row, after waiting (up to WAIT_MS) for a refresh another request is making right now, so a panel opened
 * at the same moment as another shows the answer instead of "not started yet". Gives up quietly and shows what is stored.
 */
async function settled(db: Db, key: string): Promise<Row> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const r = await read(db, key);
    const tried = ms(r.tried_at);
    const inFlight = tried > Math.max(ms(r.last_checked_at), ms(r.unreachable_at)) && Date.now() - tried < WAIT_MS * 2;
    if (!inFlight || Date.now() >= until) return r;
    await new Promise((ok) => setTimeout(ok, 250));
  }
}

/**
 * The shared watch, refreshed when it is due. Channel3 failures never throw and never wipe what is stored: the view
 * says Channel3 didn't answer (unreachableAt) and keeps the last history with its date. Database errors do throw.
 */
export async function sharedWatch(deps: SharedDeps, refresh: SharedRefresh, w = DEMO_SHARED_WATCH): Promise<SharedWatchView> {
  const { db, c3 } = deps;
  // The row is the guard: made once, whoever gets here first. Tracking starts below, for whoever claims the refresh.
  await db.query("insert into shared_watches (key, product_id, item, currency) values ($1, $2, $3, $4) on conflict (key) do nothing", [w.key, w.productId, w.item, w.currency]);
  if (refresh === "none") return toView(await read(db, w.key), "cached");

  // One caller claims each refresh (a conditional update), so many panels opening at once make one set of calls.
  const quiet = refresh === "daily" ? DAILY_QUIET_MINUTES : PANEL_MINUTES;
  const [claimed] = await db.query<Row>(
    "update shared_watches set tried_at = now() where key = $1 and (tried_at is null or tried_at < now() - make_interval(mins => $2)) returning *",
    [w.key, quiet],
  );
  if (!claimed) return toView(await settled(db, w.key), "cached");

  const unreachable = async (why: string, error: "not_found" | "unreachable" = "unreachable") => {
    console.error(`[spotter] shared price watch ${claimed.product_id}: ${why}; showing the stored history`);
    await db.query("update shared_watches set unreachable_at = now(), last_error = $2 where key = $1", [w.key, error]);
    return toView(await read(db, w.key), "failed");
  };

  if (!claimed.tracking_since) {
    let started: "active" | "not_found" | null = null;
    try {
      started = await c3.start(claimed.product_id);
    } catch (e) {
      console.error(`[spotter] starting Channel3 tracking for the shared watch failed:`, e instanceof Error ? e.message : e);
    }
    if (started !== "active") return started === "not_found" ? unreachable("Channel3 can't track this product", "not_found") : unreachable("Channel3 didn't start tracking");
    await db.query("update shared_watches set tracking_since = now() where key = $1 and tracking_since is null", [w.key]);
  }

  let fresh: Awaited<ReturnType<SharedC3["history"]>> = null;
  try {
    fresh = await c3.history(claimed.product_id);
  } catch (e) {
    console.error(`[spotter] Channel3 history for the shared watch failed:`, e instanceof Error ? e.message : e);
  }
  if (!fresh) return unreachable("Channel3 price history didn't answer");

  // Today's offers come from the product listing (free). If it doesn't answer, the last ones stay (with their date).
  let shops: SharedShop[] | null = null;
  try {
    const product = await c3.product(claimed.product_id, claimed.currency);
    if (product) {
      shops = genuineOffers(product.offers, claimed.currency)
        .sort((a, b) => a.price - b.price)
        .filter((o, i, all) => all.findIndex((x) => x.domain === o.domain) === i)
        .slice(0, MAX_SHOPS)
        .map((o) => ({ shop: o.domain, price: o.price }));
    } else console.error(`[spotter] Channel3 product listing for the shared watch didn't answer; keeping the last shop prices`);
  } catch (e) {
    console.error(`[spotter] Channel3 product listing for the shared watch failed; keeping the last shop prices:`, e instanceof Error ? e.message : e);
  }

  const points = mergePoints(claimed.history ?? [], fresh.points, claimed.currency);
  const other = fresh.points.filter((p) => p.currency !== claimed.currency).length;
  if (other && other === fresh.points.length) console.warn(`[spotter] Channel3 history for the shared watch came only in other currencies (${other} points), so none were added`);
  const status = fresh.current?.currency === claimed.currency ? fresh.current.status : null;
  await db.query(
    `update shared_watches set history = $2, title = coalesce($3, title), price_status = coalesce($4, price_status), shops = coalesce($5, shops),
       shops_checked_at = case when $5::jsonb is null then shops_checked_at else now() end, last_checked_at = now(), unreachable_at = null, last_error = null
     where key = $1`,
    [w.key, JSON.stringify(points), fresh.title?.slice(0, 300) ?? null, status, shops ? JSON.stringify(shops) : null],
  );
  return toView(await read(db, w.key), "now");
}

/** The shared watch for a signed in family: demo families only (null for anyone else, with no Channel3 call). */
export async function sharedWatchFor(deps: SharedDeps, householdId: string): Promise<SharedWatchView | null> {
  const [hh] = await deps.db.query<{ demo: boolean }>("select demo from households where id = $1", [householdId]);
  if (!hh?.demo) return null;
  return sharedWatch(deps, "hourly");
}
