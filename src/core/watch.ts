// Price watch: when a payment for a product was too dear, held or denied, the spotter (or the agent that was told
// "not now") can ask Spotter to watch the price. Spotter subscribes to that exact product at Channel3 (price
// tracking) and tells the spotter when a real retailer sells it at or below a fair target. It never buys, never
// creates an order and never nudges the person who wanted it: the spotter is told, and the spotter decides.
//
// How a drop is found: Channel3's webhook (a hint only, its price is never trusted) and the daily job both re-read
// the product's current offers from Channel3's product endpoint, which is free. Price tracking costs 1 credit per
// product per day, so watches are capped per family, in total and per day, expire after 14 days, and the Channel3
// subscription is stopped when a watch ends (retried by the daily job when Channel3 is down).
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import type { Offer } from "./market";
import type { Currency } from "./types";
import { bestProduct, familySearch, type PriceHistory, type Product } from "@/market/channel3";
import { cleanQuery } from "@/watchtower/price";

export const WATCH_DAYS = 14;
const TOO_CHEAP = 0.4; // same line as the price check: under 40% of the going rate is a fake shop tell
const HINT_QUIET_MINUTES = 10; // a webhook for a product checked this recently is a repeat
const POLL_HOURS = 12; // the daily job rechecks a watch at most this often
const POLL_BATCH = 50;
const HINT_BATCH = 5; // one webhook delivery checks at most this many watches (each check can take a few seconds)
const HISTORY_POINTS = 30;
const WATCHABLE = ["needs_approval", "blocked", "voided", "voiding", "protected"];

const envCap = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export type WatchC3 = {
  search(query: string, currency: Currency, limit: number): Promise<Product[] | null>;
  start(productId: string): Promise<"active" | "not_found" | null>;
  stop(productId: string): Promise<true | null>;
  history(productId: string): Promise<PriceHistory | null>;
  product(productId: string, currency: Currency): Promise<Product | null>;
};
export type WatchCaps = { perHousehold: number; active: number; perDay: number; perFamilyDay?: number };
export type WatchDeps = { db: Db; c3: WatchC3; notify?: (w: WatchView & { householdId: string }) => Promise<void>; caps?: WatchCaps };

export type WatchStatus = "watching" | "dropped" | "stopped" | "expired";
export type WatchHistory = { source: "channel3" | "checks"; points: Array<{ at: string; price: number }>; status?: "low" | "typical" | "high" };
export type WatchView = {
  id: string;
  paymentId: string | null;
  who: string | null;
  item: string;
  title: string;
  currency: Currency;
  nearlyPaid: number;
  target: number;
  /** The cheapest genuine offer at the last check; when dropped, the offer that met the target. */
  best: { price: number; shop: string; url: string } | null;
  /** What they nearly paid minus the drop price, when it dropped below it. */
  saving: number | null;
  status: WatchStatus;
  history: WatchHistory | null;
  createdAt: string;
  expiresAt: string;
  lastCheckedAt: string | null;
  example: boolean;
  createdBy: string;
};

type Row = {
  id: string;
  household_id: string | null;
  payment_id: string | null;
  product_id: string;
  item: string;
  title: string;
  currency: Currency;
  nearly_paid: string | number;
  target: string | number;
  best_price: string | number | null;
  best_shop: string | null;
  best_url: string | null;
  history: WatchHistory | null;
  status: WatchStatus;
  example: boolean;
  created_by: string;
  created_at: string | Date;
  expires_at: string | Date;
  last_checked_at: string | Date | null;
  who: string | null;
};

const iso = (d: string | Date) => new Date(d).toISOString();

function toView(r: Row): WatchView {
  const best = r.best_price !== null && r.best_shop ? { price: Number(r.best_price), shop: r.best_shop, url: r.best_url ?? "" } : null;
  const nearly = Number(r.nearly_paid);
  return {
    id: r.id,
    paymentId: r.payment_id,
    who: r.who,
    item: r.item,
    title: r.title,
    currency: r.currency,
    nearlyPaid: nearly,
    target: Number(r.target),
    best,
    saving: r.status === "dropped" && best && best.price < nearly ? nearly - best.price : null,
    status: r.status,
    history: r.history,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    lastCheckedAt: r.last_checked_at ? iso(r.last_checked_at) : null,
    example: r.example,
    createdBy: r.created_by,
  };
}

const SELECT = "select w.*, s.name as who from price_watches w left join spenders s on s.id = w.spender_id";

async function getRow(db: Db, id: string): Promise<Row | null> {
  return (await db.query<Row>(`${SELECT} where w.id = $1`, [id]))[0] ?? null;
}

// ---------- pure rules ----------

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Real offers only: the family's currency, and never a price far below the going rate (a fake shop tell). */
export function genuineOffers(offers: Offer[], currency: Currency): Offer[] {
  const same = offers.filter((o) => o.currency === currency && o.price > 0);
  if (same.length < 2) return same;
  const going = median(same.map((o) => o.price));
  return same.filter((o) => o.price >= going * TOO_CHEAP);
}

const cheapest = (offers: Offer[]) => offers.reduce<Offer | null>((a, b) => (!a || b.price < a.price ? b : a), null);

/** Round down to whole pounds (or to 10p under £20), so the target reads plainly. */
const roundDown = (n: number) => (n >= 2000 ? Math.floor(n / 100) * 100 : Math.floor(n / 10) * 10);

/**
 * The price that counts as a real drop: a little (3%) under today's best real price, and at least 10% under what they
 * nearly paid when that was more. Without a real price, 10% under what they nearly paid. A nearly paid price below
 * every real shop (a fake shop) is ignored.
 */
export function targetPrice(nearly: number, startBest: number | null): number {
  const tenOff = nearly * 0.9;
  if (startBest === null) return Math.max(1, roundDown(tenOff));
  const under = startBest * 0.97;
  return Math.max(1, roundDown(nearly > startBest ? Math.min(under, tenOff) : under));
}

/**
 * The small price history line. Channel3's own history when it has two or more points in the family's currency
 * (it sometimes answers in another currency); otherwise Spotter's own checks of real offers, one per day.
 */
export function mergeHistory(prev: WatchHistory | null, fresh: PriceHistory | null, check: { at: string; price: number } | null, currency: Currency): WatchHistory | null {
  // Channel3's history call being down is not "no history": keep the line it gave before.
  if (fresh === null && prev?.source === "channel3") return prev;
  const theirs = (fresh?.points ?? []).filter((p) => p.currency === currency);
  if (theirs.length >= 2) {
    const status = fresh?.current?.currency === currency ? fresh.current.status : undefined;
    return { source: "channel3", points: theirs.slice(-HISTORY_POINTS).map((p) => ({ at: p.at, price: p.price })), ...(status ? { status } : {}) };
  }
  // A short answer (one point, or none in this currency) doesn't throw away the line Channel3 gave before: the
  // newest point is added to it instead.
  if (prev?.source === "channel3") {
    const latest = theirs.at(-1);
    const add = latest ? { at: latest.at, price: latest.price } : check;
    if (!add) return prev;
    const kept = [...prev.points];
    if (kept.at(-1)?.at.slice(0, 10) === add.at.slice(0, 10)) kept[kept.length - 1] = add;
    else kept.push(add);
    return { ...prev, points: kept.slice(-HISTORY_POINTS) };
  }
  const points = prev?.source === "checks" ? [...prev.points] : [];
  if (check) {
    const day = check.at.slice(0, 10);
    const last = points.at(-1);
    if (last && last.at.slice(0, 10) === day) points[points.length - 1] = check;
    else points.push(check);
  }
  return points.length ? { source: "checks", points: points.slice(-HISTORY_POINTS) } : prev?.source === "checks" ? prev : null;
}

// ---------- starting and stopping ----------

export type WatchResult = { watch: WatchView } | { error: string; status: number };
export type StartInput = { householdId: string; paymentId?: string; spenderId?: string; item: string; currency: Currency; nearly: number; createdBy: string };

function capsOf(deps: WatchDeps): WatchCaps {
  return (
    deps.caps ?? {
      perHousehold: envCap("PRICE_WATCHES_PER_FAMILY", 5),
      active: envCap("PRICE_WATCHES_ACTIVE", 100),
      perDay: envCap("PRICE_WATCHES_PER_DAY", 40),
    }
  );
}

// The overall per day cap counts watches that ran (not ones their family stopped), so one family starting and
// stopping can't use up the day for everyone; the family's own per day cap ($5) counts every watch it started.
const CAP_WHERE = `(select count(*) from price_watches where household_id = $1 and status = 'watching') < $2
  and (select count(*) from price_watches where status = 'watching' and not example) < $3
  and (select count(*) from price_watches where created_at > now() - interval '1 day' and status <> 'stopped' and not example) < $4
  and (select count(*) from price_watches where household_id = $1 and created_at > now() - interval '1 day' and not example) < $5`;

/** Ends Channel3's subscription for a product once no watch needs it. Leaves tracking on when Channel3 is down, for the daily job. */
async function release(deps: WatchDeps, productId: string): Promise<void> {
  const still = await deps.db.query("select 1 from price_watches where product_id = $1 and status = 'watching' and household_id is not null limit 1", [productId]);
  if (still.length) {
    await deps.db.query("update price_watches set tracking = false where product_id = $1 and status <> 'watching' and tracking", [productId]);
    return;
  }
  let stopped: true | null = null;
  try {
    stopped = await deps.c3.stop(productId);
  } catch (e) {
    console.error(`[spotter] stopping Channel3 tracking for ${productId} failed:`, e instanceof Error ? e.message : e);
  }
  if (stopped) await deps.db.query("update price_watches set tracking = false where product_id = $1 and (status <> 'watching' or household_id is null)", [productId]);
  else console.error(`[spotter] Channel3 tracking for ${productId} is still on; the daily job will try again`);
}

export async function startWatch(deps: WatchDeps, input: StartInput): Promise<WatchResult> {
  const { db, c3 } = deps;
  const item = cleanQuery(input.item);
  if (!item) return { error: "Spotter needs the product's name to watch its price.", status: 400 };
  if (!Number.isInteger(input.nearly) || input.nearly <= 0) return { error: "Say what the price was, in pence or cents.", status: 400 };
  const caps = capsOf(deps);
  const capArgs = [input.householdId, caps.perHousehold, caps.active, caps.perDay, caps.perFamilyDay ?? envCap("PRICE_WATCHES_PER_FAMILY_PER_DAY", 10)];
  const full = async (): Promise<WatchResult> => {
    const [mine] = await db.query<{ n: string }>("select count(*)::text as n from price_watches where household_id = $1 and status = 'watching'", [input.householdId]);
    return Number(mine?.n ?? 0) >= caps.perHousehold
      ? { error: `You're already watching ${caps.perHousehold} prices. Stop one to watch another.`, status: 429 }
      : { error: "Spotter is watching as many prices as it can today. Try again tomorrow.", status: 429 };
  };

  // Caps first, so a full family or a busy day never spends a Channel3 credit.
  if (!(await db.query(`select 1 where ${CAP_WHERE}`, capArgs)).length) return full();

  // Each search is a Channel3 credit, spent before any watch row exists: cached, and capped per family and per day.
  const products = await familySearch(db, input.householdId, (q, c, l) => c3.search(q, c, l), item, input.currency, 8);
  if (products === "capped") return { error: "Spotter has looked up all the products it can today. Try again tomorrow.", status: 429 };
  if (!products) return { error: "Real shop prices are unavailable right now, so nothing is watched yet. Try again in a minute.", status: 502 };
  const product = bestProduct(products, item);
  if (!product) return { error: "Spotter couldn't find this exact product at real shops, so there's no price to watch.", status: 404 };

  const existing = (await db.query<Row>(`${SELECT} where w.household_id = $1 and w.product_id = $2 and w.status = 'watching'`, [input.householdId, product.id]))[0];
  if (existing) return { watch: toView(existing) };

  const best = cheapest(genuineOffers(product.offers, input.currency));
  const target = targetPrice(input.nearly, best?.price ?? null);

  const id = `watch_${randomBytes(9).toString("hex")}`;
  // The row is saved before Channel3's subscription starts, so release() for another family's watch on the same
  // product sees it and leaves tracking on, and a request cut off after the start still leaves a row the daily job
  // ends and stops. tracking = true means "may be tracked": stopping a product that isn't tracked is harmless.
  // Caps again in the insert itself, so two requests racing can't both take the last slot.
  const rows = await db.query<{ id: string }>(
    `insert into price_watches (id, household_id, payment_id, spender_id, product_id, item, title, currency, nearly_paid, target,
       best_price, best_shop, best_url, tracking, created_by, expires_at)
     select $6, $1, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true, $18, now() + make_interval(days => ${WATCH_DAYS})
     where ${CAP_WHERE}
     on conflict do nothing
     returning id`,
    [
      ...capArgs,
      id,
      input.paymentId ?? null,
      input.spenderId ?? null,
      product.id,
      item,
      product.title.slice(0, 300),
      input.currency,
      input.nearly,
      target,
      best?.price ?? null,
      best?.domain ?? null,
      best?.url ?? null,
      input.createdBy,
    ],
  );
  if (!rows.length) {
    const again = (await db.query<Row>(`${SELECT} where w.household_id = $1 and w.product_id = $2 and w.status = 'watching'`, [input.householdId, product.id]))[0];
    return again ? { watch: toView(again) } : full();
  }

  // If Channel3 won't track it, the row goes again. Nothing was started, so there is nothing to stop.
  // A row that can't be removed is logged: it ends at expiry and the daily job's stop is harmless for it.
  const forget = () =>
    db
      .query("delete from price_watches where id = $1", [id])
      .catch((err: unknown) => console.error(`[spotter] price watch ${id} couldn't be removed after Channel3 didn't start tracking:`, err instanceof Error ? err.message : err));
  let started: "active" | "not_found" | null;
  try {
    started = await c3.start(product.id);
  } catch (e) {
    await forget();
    throw e;
  }
  if (started !== "active") {
    await forget();
    return started === "not_found"
      ? { error: "Channel3 can't track this product, so there's no price to watch.", status: 404 }
      : { error: "Real shop prices are unavailable right now, so nothing is watched yet. Try again in a minute.", status: 502 };
  }

  let history: WatchHistory | null = null;
  try {
    history = mergeHistory(null, await c3.history(product.id), best ? { at: new Date().toISOString(), price: best.price } : null, input.currency);
  } catch (e) {
    console.error(`[spotter] price history for ${product.id} failed:`, e instanceof Error ? e.message : e);
  }
  // The watch is saved and tracked by now, so a failed history write is logged, not reported as a failed watch.
  if (history) {
    await db
      .query("update price_watches set history = $2 where id = $1", [id, JSON.stringify(history)])
      .catch((e: unknown) => console.error(`[spotter] saving the price history for ${id} failed; the next check fills it in:`, e instanceof Error ? e.message : e));
  }
  return { watch: toView((await getRow(db, id))!) };
}

type PaymentBits = { id: string; spender_id: string; status: string; amount: string | number; currency: Currency; item: string | null; household_id: string };

/** A watch on the product of one of this family's held, denied or stopped payments. `onlySpender` keeps an agent to its own payments. */
export async function watchFromPayment(deps: WatchDeps, householdId: string, paymentId: string, opts: { createdBy?: string; onlySpender?: string } = {}): Promise<WatchResult> {
  const [p] = await deps.db.query<PaymentBits>(
    `select p.id, p.spender_id, p.status, p.amount, p.currency, p.request->>'item' as item, s.household_id
     from payments p join spenders s on s.id = p.spender_id where p.id = $1`,
    [paymentId],
  );
  if (!p || p.household_id !== householdId || (opts.onlySpender && p.spender_id !== opts.onlySpender)) return { error: "No payment with that id.", status: 404 };
  if (!WATCHABLE.includes(p.status)) return { error: "Only a held, denied or stopped payment can have its price watched.", status: 409 };
  if (!p.item?.trim()) return { error: "This payment didn't say which product it was for, so there's no price to watch.", status: 400 };
  return startWatch(deps, { householdId, paymentId: p.id, spenderId: p.spender_id, item: p.item, currency: p.currency, nearly: Number(p.amount), createdBy: opts.createdBy ?? "spotter" });
}

export async function stopWatch(deps: WatchDeps, householdId: string, watchId: string): Promise<WatchResult> {
  const r = await getRow(deps.db, watchId);
  if (!r || r.household_id !== householdId) return { error: "No price watch with that id.", status: 404 };
  if (r.status === "watching") {
    await deps.db.query("update price_watches set status = 'stopped' where id = $1 and status = 'watching'", [watchId]);
    await release(deps, r.product_id);
  }
  return { watch: toView((await getRow(deps.db, watchId))!) };
}

export async function listWatches(db: Db, householdId: string, limit = 20): Promise<WatchView[]> {
  return (await db.query<Row>(`${SELECT} where w.household_id = $1 order by w.created_at desc limit $2`, [householdId, limit])).map(toView);
}

// ---------- finding drops ----------

/**
 * Tells the spotter about a drop. notified_at is written only once a notice really went out, so a failed or cut off
 * send is tried again by the daily job (runWatches). Never throws: a failure is logged and left for the retry.
 */
async function tellSpotter(deps: WatchDeps, watchId: string, householdId: string): Promise<boolean> {
  if (!deps.notify) return false;
  try {
    const view = await getRow(deps.db, watchId);
    if (!view) return false;
    await deps.notify({ ...toView(view), householdId });
  } catch (e) {
    console.error(`[spotter] telling the spotter about price drop ${watchId} failed; the daily job tries again:`, e instanceof Error ? e.message : e);
    return false;
  }
  try {
    await deps.db.query("update price_watches set notified_at = now() where id = $1", [watchId]);
    return true;
  } catch (e) {
    console.error(`[spotter] price drop ${watchId}: the notice went out but notified_at wasn't saved, so the daily job may send it again:`, e instanceof Error ? e.message : e);
    return true;
  }
}

/** Re-reads the product's real offers at Channel3 and records a drop at most once. Never uses a price from a webhook. */
export async function checkWatch(deps: WatchDeps, watchId: string): Promise<"dropped" | "watching" | "unavailable" | "skipped"> {
  const { db, c3 } = deps;
  const w = await getRow(db, watchId);
  // Past its 14 days it is over, even before the daily job marks it expired.
  if (!w || w.status !== "watching" || !w.household_id || w.example || new Date(w.expires_at).getTime() <= Date.now()) return "skipped";
  const product = await c3.product(w.product_id, w.currency);
  if (!product) return "unavailable";
  const best = cheapest(genuineOffers(product.offers, w.currency));
  const now = new Date().toISOString();
  let fresh: PriceHistory | null = null;
  try {
    fresh = await c3.history(w.product_id);
  } catch (e) {
    console.error(`[spotter] price history for ${w.product_id} failed:`, e instanceof Error ? e.message : e);
  }
  const history = mergeHistory(w.history, fresh, best ? { at: now, price: best.price } : null, w.currency);
  // The product read worked, so an empty shelf really is empty: the best price is cleared, not kept from last time.
  // A history outage keeps the history that was there (mergeHistory, and coalesce here).
  await db.query(
    `update price_watches set last_checked_at = now(), history = coalesce($2, history), best_price = $3, best_shop = $4, best_url = $5
     where id = $1 and status = 'watching'`,
    [w.id, history ? JSON.stringify(history) : null, best?.price ?? null, best?.domain ?? null, best?.url ?? null],
  );
  if (!best || best.price > Number(w.target)) return "watching";

  // One conditional update decides the drop, so a webhook and the daily job racing can't both tell the spotter.
  const won = await db.query("update price_watches set status = 'dropped' where id = $1 and status = 'watching' and expires_at > now() returning id", [w.id]);
  if (!won.length) return "skipped";
  // The spotter is told first; stopping the subscription comes after and the daily job retries it if it fails.
  await tellSpotter(deps, w.id, w.household_id);
  try {
    await release(deps, w.product_id);
  } catch (e) {
    console.error(`[spotter] stopping tracking after price drop ${w.id} failed; the daily job retries:`, e instanceof Error ? e.message : e);
  }
  return "dropped";
}

/**
 * Channel3's price.changed webhook says "this product's price moved". Only that product id is used: each watch on
 * it is re-checked against Channel3's real offers. A watch checked in the last few minutes is skipped (a repeat).
 * Returns how many were really checked; one that hit an outage isn't marked checked, so the daily job still polls it.
 */
export async function hintFromWebhook(deps: WatchDeps, productId: string): Promise<number> {
  // Watches on it that ran past their 14 days end now (not at the next daily run), and stop costing credits.
  const ended = await deps.db.query("update price_watches set status = 'expired' where product_id = $1 and status = 'watching' and expires_at <= now() returning id", [productId]);
  if (ended.length) {
    await release(deps, productId).catch((e: unknown) =>
      console.error(`[spotter] stopping tracking for expired watches on ${productId} failed; the daily job retries:`, e instanceof Error ? e.message : e),
    );
  }
  const rows = await deps.db.query<{ id: string }>(
    `select id from price_watches where product_id = $1 and status = 'watching' and household_id is not null and not example and expires_at > now()
       and (last_checked_at is null or last_checked_at < now() - make_interval(mins => ${HINT_QUIET_MINUTES}))
     order by created_at limit ${HINT_BATCH}`,
    [productId],
  );
  let checked = 0;
  for (const r of rows) {
    try {
      const got = await checkWatch(deps, r.id);
      if (got === "watching" || got === "dropped") checked++;
    } catch (e) {
      console.error(`[spotter] checking price watch ${r.id} after a webhook failed:`, e instanceof Error ? e.message : e);
    }
  }
  return checked;
}

export type WatchRun = { expired: number; stopped: number; checked: number; dropped: number; unavailable: number; failed: number; retold: number };

/** Time a single check (or a notice) may need: none is started with less than this left of the budget. */
const CHECK_RESERVE_MS = 25_000;

/**
 * The daily job: end old watches, stop subscriptions nobody needs (retrying failures), tell the spotter about drops
 * whose notice failed, and poll the rest within a time budget. The caller passes what's left of its own time.
 */
export async function runWatches(deps: WatchDeps, budgetMs = 40_000): Promise<WatchRun> {
  const { db } = deps;
  const until = Date.now() + budgetMs;
  await db.query("update price_watches set status = 'stopped' where household_id is null and status = 'watching'");
  const expired = await db.query("update price_watches set status = 'expired' where status = 'watching' and expires_at < now() returning id");
  const loose = await db.query<{ product_id: string }>("select distinct product_id from price_watches where tracking and (status <> 'watching' or household_id is null)");
  let failed = 0;
  for (const r of loose) {
    try {
      await release(deps, r.product_id);
    } catch (e) {
      failed++;
      console.error(`[spotter] stopping Channel3 tracking for ${r.product_id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  const [still] = await db.query<{ n: string }>(
    "select count(distinct product_id)::text as n from price_watches where tracking and (status <> 'watching' or household_id is null)",
  );
  await db.query("delete from price_watches where household_id is null and not tracking");

  const due = await db.query<{ id: string }>(
    `select id from price_watches where status = 'watching' and household_id is not null and not example
       and (last_checked_at is null or last_checked_at < now() - make_interval(hours => ${POLL_HOURS}))
     order by last_checked_at nulls first limit ${POLL_BATCH}`,
  );
  // Drops whose notice didn't go out (every channel failed, or the run was cut off) are told again, for 3 days.
  const unsent = await db.query<{ id: string; household_id: string }>(
    `select id, household_id from price_watches where status = 'dropped' and notified_at is null and household_id is not null and not example
       and last_checked_at > now() - interval '3 days' order by last_checked_at limit ${POLL_BATCH}`,
  );
  let retold = 0;
  for (const r of unsent) {
    if (until - Date.now() < CHECK_RESERVE_MS) break;
    if (await tellSpotter(deps, r.id, r.household_id)) retold++;
  }

  let checked = 0;
  let dropped = 0;
  let unavailable = 0;
  for (const r of due) {
    // A check can take tens of seconds (several Channel3 calls, a notice, a stop), so one isn't started without
    // that much time left: the route must not be killed half way through a drop. The rest wait (oldest first).
    if (until - Date.now() < CHECK_RESERVE_MS) break;
    try {
      const got = await checkWatch(deps, r.id);
      if (got === "unavailable") unavailable++;
      else if (got !== "skipped") checked++;
      if (got === "dropped") dropped++;
    } catch (e) {
      failed++;
      console.error(`[spotter] checking price watch ${r.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { expired: expired.length, stopped: loose.length - Number(still?.n ?? 0), checked, dropped, unavailable, failed, retold };
}

// ---------- the demo family's example ----------

export const EXAMPLE_WATCH_LABEL = "Example, checked earlier";

/**
 * One example price drop for a new demo family, so a judge sees what a drop looks like without waiting days. It is
 * labelled as an example everywhere, has no Channel3 subscription (no credits) and the daily job never touches it.
 */
export async function createExampleWatch(db: Db, householdId: string): Promise<void> {
  const [gran] = await db.query<{ id: string }>("select id from spenders where household_id = $1 and kind = 'person' order by created_at limit 1", [householdId]);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const history: WatchHistory = {
    source: "checks",
    points: [8900, 8900, 8400, 8400, 7900, 6900].map((price, i) => ({ at: day(10 - i * 2), price })),
  };
  await db.query(
    `insert into price_watches (id, household_id, spender_id, product_id, item, title, currency, nearly_paid, target, best_price, best_shop, best_url,
       history, status, tracking, example, created_by, created_at, expires_at, last_checked_at, notified_at)
     values ($1, $2, $3, 'example', 'Over ear wireless headphones', 'Over ear wireless headphones (example)', 'GBP', 8900, 7600, 6900,
       'harbourline-audio.co.uk', '', $4, 'dropped', false, true, 'spotter', $5, $6, $7, $7)`,
    [`watch_example_${randomBytes(6).toString("hex")}`, householdId, gran?.id ?? null, JSON.stringify(history), day(10), day(-4), day(0)],
  );
}
