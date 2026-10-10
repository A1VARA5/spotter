import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, getPayment, submitPayment, type Deps, type Payment } from "@/core/lifecycle";
import { fileReport } from "@/core/network";
import type { LinkReport } from "./links";
import { runTool, type CaseCtx } from "./tools";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(5000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };

let db: Db;
let deps: Deps;
let hh: string;
let other: string;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

beforeEach(async () => {
  db = await pgliteDb();
  deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A9", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Aivaras" })).id;
  other = (await createHousehold(db, { name: "Other", spotterName: "Sam" })).id;
  await createSpender(db, { id: "gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Aivaras", allowance });
  await createSpender(db, { id: "stranger", householdId: other, name: "Bob", kind: "person", spotterName: "Sam", allowance });
});

const pay = (spenderId: string, payee: string, amount: number, context = "") =>
  submitPayment(deps, { spenderId, money: gbp(amount), payee: { name: payee, isNew: true }, category: "family", method: "paypal_order", context });

function ctx(payment: Payment, over: Partial<CaseCtx> = {}): CaseCtx {
  return { db, householdId: hh, payment, offers: new Map(), ...over };
}

describe("payee_history", () => {
  it("finds this family's past payments to the same or a look-alike payee, not other families'", async () => {
    await pay("gran", "jamie.k1995@gmail.com", 1000);
    await pay("stranger", "jamie.k1994@gmail.com", 1000);
    const now = await pay("gran", "jamie.k1994@gmail.com", 25000);
    const out = await runTool("payee_history", { payee: "jamie.k1994@gmail.com" }, ctx(now));
    expect(out.ok).toBe(true);
    const data = out.data as { exact: unknown[]; similar: Array<{ payee: string }> };
    expect(data.exact).toHaveLength(0);
    expect(data.similar.map((s) => s.payee)).toEqual(["jamie.k1995@gmail.com"]);
    expect(out.summary).toMatch(/never paid/i);
  });
});

describe("network_reports", () => {
  it("counts other families that said no", async () => {
    await fileReport(db, { householdId: other, identifier: "jamie.k1994@gmail.com", kind: "denied" });
    const now = await pay("gran", "jamie.k1994@gmail.com", 25000);
    const out = await runTool("network_reports", { identifier: "jamie.k1994@gmail.com" }, ctx(now));
    expect((out.data as { families: number }).families).toBe(1);
  });
});

describe("check_links", () => {
  const report = (url: string): LinkReport => ({
    input: url, url, host: "bargainpods.shop", domain: "bargainpods.shop", finalUrl: url, hops: [], ageDays: 6, registered: "2026-10-04",
    brand: null, official: false, flags: [{ code: "new-domain", severity: "high", detail: "Registered 6 days ago." }],
  });

  it("only checks links that are really in the message", async () => {
    const now = await pay("gran", "BargainPods", 2499, "Buy now at https://bargainpods.shop/airpods today");
    const inspect = vi.fn(async (u: string) => report(u));
    const out = await runTool("check_links", { urls: ["https://bargainpods.shop/airpods", "https://evil.example/?d=secret"] }, ctx(now, { inspect }));
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith("https://bargainpods.shop/airpods");
    expect(out.summary).toContain("not in the message");
    expect(out.summary).toContain("6 days");
  });

  it("refuses when no link from the message is asked for", async () => {
    const now = await pay("gran", "BargainPods", 2499, "no links here");
    const inspect = vi.fn(async (u: string) => report(u));
    const out = await runTool("check_links", { urls: ["https://evil.example/"] }, ctx(now, { inspect }));
    expect(out.ok).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("find_genuine_offer", () => {
  it("returns real retailer offers with ids it remembers for a swap", async () => {
    const now = await pay("gran", "BargainPods", 2499);
    const search = vi.fn(async () => [
      { id: "p1", title: "Apple AirPods Pro 2", offers: [
        { title: "Apple AirPods Pro 2", domain: "currys.co.uk", price: 17900, currency: "GBP" as const, url: "https://currys.co.uk/a" },
        { title: "Apple AirPods Pro 2", domain: "argos.co.uk", price: 18900, currency: "GBP" as const, url: "https://argos.co.uk/a" },
      ] },
      { id: "p2", title: "AirPods Pro 2 case cover", offers: [{ title: "x", domain: "ebay.co.uk", price: 500, currency: "GBP" as const, url: "https://ebay.co.uk/x" }] },
    ]);
    const c = ctx(now, { search });
    const out = await runTool("find_genuine_offer", { item: "Apple AirPods Pro 2" }, c);
    const offers = (out.data as { offers: Array<{ offer_id: string; domain: string; price: number }> }).offers;
    expect(offers.map((o) => o.domain)).toEqual(["currys.co.uk", "argos.co.uk"]);
    expect(c.offers.get(offers[0]!.offer_id)?.url).toBe("https://currys.co.uk/a");
  });

  it("says when the search is down instead of guessing", async () => {
    const now = await pay("gran", "BargainPods", 2499);
    const out = await runTool("find_genuine_offer", { item: "AirPods" }, ctx(now, { search: async () => null }));
    expect(out.ok).toBe(false);
  });
});

describe("paypal_hold", () => {
  it("reports the hold status and when it runs out", async () => {
    const now = await pay("gran", "jamie.k1994@gmail.com", 25000);
    const held = (await getPayment(db, now.id))!;
    const getAuthorization = vi.fn(async () => ({ status: "CREATED", expiresAt: "2026-11-07T00:00:00Z" }));
    const out = await runTool("paypal_hold", {}, ctx(held, { getAuthorization }));
    expect(getAuthorization).toHaveBeenCalledWith("A9");
    expect(out.summary).toContain("CREATED");
    expect(out.summary).toContain("2026-11-07");
  });
});

describe("runTool", () => {
  it("turns bad arguments and unknown tools into a failed result, never a throw", async () => {
    const now = await pay("gran", "x@y.com", 100);
    expect((await runTool("payee_history", { payee: 5 }, ctx(now))).ok).toBe(false);
    expect((await runTool("send_money", {}, ctx(now))).ok).toBe(false);
  });
});
