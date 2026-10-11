import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender } from "@/core/lifecycle";
import type { WatchC3, WatchDeps } from "@/core/watch";
import { agentWatchPrice } from "./agent";

const allowance = { weekly: { amount: 15000, currency: "GBP" as const }, askAbove: { amount: 3000, currency: "GBP" as const }, blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const prod = { id: "EB1", title: "Pro wireless earbuds 2", offers: [{ title: "Pro wireless earbuds 2", domain: "fair.co.uk", price: 15900, currency: "GBP" as const, url: "https://fair.co.uk/x" }] };

let db: Db;
let deps: WatchDeps;
let start: ReturnType<typeof vi.fn<WatchC3["start"]>>;

async function pay(id: string, spender: string, status: string) {
  const request = { id, spenderId: spender, money: { amount: 21900, currency: "GBP" }, payee: { name: "earbuds-outlet.shop", isNew: true }, category: "electronics", method: "paypal_order", context: "", createdAt: new Date().toISOString(), item: "Pro wireless earbuds 2" };
  await db.query("insert into payments (id, spender_id, request, status, amount, currency) values ($1, $2, $3, $4, 21900, 'GBP')", [id, spender, JSON.stringify(request), status]);
}

beforeEach(async () => {
  db = await pgliteDb();
  const hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
  await createSpender(db, { householdId: hh, id: "agent", name: "Shopping agent", kind: "agent", spotterName: "Sam", allowance });
  await createSpender(db, { householdId: hh, id: "other", name: "Other agent", kind: "agent", spotterName: "Sam", allowance });
  start = vi.fn<WatchC3["start"]>(async () => "active");
  const c3: WatchC3 = { search: vi.fn(async () => [prod]), start, stop: vi.fn(async () => true as const), history: vi.fn(async () => null), product: vi.fn(async () => prod) };
  deps = { db, c3 };
});

describe("watch_price for AI agents", () => {
  it("watches the price of the agent's own held payment for the spotter, and says the agent can't buy on a drop", async () => {
    await pay("pay_a", "agent", "voided");
    const r = await agentWatchPrice(deps, "agent", { payment_id: "pay_a" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Sam");
    expect(r.message).toMatch(/can't buy it/i);
    expect(r.message).toContain("£154.00");
    const [row] = await db.query<{ created_by: string; spender_id: string }>("select created_by, spender_id from price_watches");
    expect(row).toEqual({ created_by: "agent", spender_id: "agent" });
  });

  it("can't watch another agent's payment", async () => {
    await pay("pay_o", "other", "voided");
    const r = await agentWatchPrice(deps, "agent", { payment_id: "pay_o" });
    expect(r.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("can watch an item it was told was too expensive, with the price it would have paid", async () => {
    const r = await agentWatchPrice(deps, "agent", { item: "Pro wireless earbuds 2", price_pence: 21900, currency: "GBP" });
    expect(r.ok).toBe(true);
  });

  it("needs a payment id, or an item with a price", async () => {
    expect((await agentWatchPrice(deps, "agent", { item: "Pro wireless earbuds 2" })).ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});
