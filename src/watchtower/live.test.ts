import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender } from "@/core/lifecycle";
import { HH_COOKIE, householdCookie } from "@/server/auth";
import { makeLive } from "./live";

const cookieFor = (hh: string) => `${HH_COOKIE}=${/=([^;]*)/.exec(householdCookie(hh))![1]}`;
const req = (hh: string | null, since?: string) =>
  new Request(`http://x/api/watchtower/live${since === undefined ? "" : `?since=${encodeURIComponent(since)}`}`, { headers: hh ? { cookie: cookieFor(hh) } : {} });

const allowance = { weekly: { amount: 30000, currency: "GBP" }, askAbove: { amount: 5000, currency: "GBP" }, blockedCategories: [], allowedPayees: [], blockedPayees: [] };

async function pay(db: Db, id: string, spender: string, status: string, pence: number, payee = "Corner Grocer") {
  const request = { id, spenderId: spender, money: { amount: pence, currency: "GBP" }, payee: { name: payee, isNew: false }, category: "groceries", method: "paypal_order", context: "secret scam text", createdAt: new Date().toISOString() };
  await db.query("insert into payments (id, spender_id, request, status, amount, currency) values ($1, $2, $3, $4, $5, 'GBP')", [id, spender, JSON.stringify(request), status, pence]);
}

let db: Db;
let a: string;
let b: string;
beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  a = (await createHousehold(db, { name: "A", spotterName: "Sam" })).id;
  b = (await createHousehold(db, { name: "B", spotterName: "Bo" })).id;
  await createSpender(db, { id: "sp_gran", householdId: a, name: "Gran", kind: "person", spotterName: "Sam", allowance } as never);
  await createSpender(db, { id: "sp_other", householdId: b, name: "Other", kind: "person", spotterName: "Bo", allowance } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
  vi.restoreAllMocks();
});

describe("watchtower live", () => {
  it("needs a signed in family and a real time", async () => {
    const live = makeLive(db);
    expect((await live(req(null, new Date().toISOString()))).status).toBe(401);
    expect((await live(req(a, "yesterday-ish"))).status).toBe(400);
    expect((await live(req(a))).status).toBe(400);
  });

  it("says nothing changed when nothing did, and hands back the server's time for next time", async () => {
    const live = makeLive(db);
    const res = await live(req(a, new Date(Date.now() + 60_000).toISOString()));
    const j = await res.json();
    expect(j.changed).toBe(false);
    expect(Number.isFinite(Date.parse(j.now))).toBe(true);
    expect(j.sources).toBeUndefined();
  });

  it("sends fresh board data and a plain notice when a payment changed, for this family only", async () => {
    const live = makeLive(db);
    const since = new Date(Date.now() - 60_000).toISOString();
    await pay(db, "pay_1", "sp_gran", "voided", 2499);
    await pay(db, "pay_2", "sp_other", "captured", 999);
    const j = await (await live(req(a, since))).json();
    expect(j.changed).toBe(true);
    expect(j.sources.payments.map((r: { id: string }) => r.id)).toEqual(["pay_1"]);
    expect(j.notices).toEqual(["PayPal confirmed £24.99 released"]);
    expect(JSON.stringify(j)).not.toContain("secret scam text");
    expect(j.sources.paypal).toBeUndefined();
  });

  it("words each kind of change", async () => {
    const live = makeLive(db);
    const since = new Date(Date.now() - 60_000).toISOString();
    await pay(db, "p1", "sp_gran", "captured", 1000, "Corner Grocer");
    await pay(db, "p2", "sp_gran", "needs_approval", 4000);
    await pay(db, "p3", "sp_gran", "blocked", 40000);
    const j = await (await live(req(a, since))).json();
    expect(j.notices).toEqual(expect.arrayContaining(["PayPal confirmed £10.00 paid to Corner Grocer", "Gran's £40.00 is waiting for you", "Spotter stopped £400.00 for Gran"]));
  });

  it("fails loudly when the PayPal table is there but broken, so the page doesn't skip past events", async () => {
    await db.query("create table paypal_events (id text primary key, created_at timestamptz default now())");
    await expect(makeLive(db)(req(a, new Date().toISOString()))).rejects.toThrow(/payment_id/);
  });

  it("includes PayPal's own events when the table exists", async () => {
    await db.query("create table paypal_events (id text primary key, payment_id text, event_type text, created_at timestamptz default now())");
    await pay(db, "pay_1", "sp_gran", "captured", 2499);
    const since = new Date(Date.now() - 60_000).toISOString();
    await db.query("insert into paypal_events (id, payment_id, event_type) values ('WH-1', 'pay_1', 'PAYMENT.CAPTURE.COMPLETED')");
    const j = await (await makeLive(db)(req(a, since))).json();
    expect(j.sources.paypal).toEqual([expect.objectContaining({ id: "WH-1", label: "PayPal captured", amount: 24.99, paymentId: "pay_1" })]);
    expect(j.notices[0]).toBe("PayPal captured £24.99");
  });
});
