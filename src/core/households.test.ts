import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createDemoHousehold, createHousehold, deleteStaleDemoHouseholds, getHousehold, listSpenders } from "./households";
import { createSpender, getPayment, listPayments, submitPayment, type Deps } from "./lifecycle";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(10000), askAbove: gbp(2000), blockedCategories: [], allowedPayees: ["Boots"], blockedPayees: [] };

let db: Db;
let deps: Deps;

beforeEach(async () => {
  db = await pgliteDb();
  deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
});

async function householdWithPayment(name: string) {
  const hh = await createHousehold(db, { name, spotterName: name });
  const id = `sp_${name}`;
  await createSpender(db, { id, householdId: hh.id, name: "Gran", kind: "person", spotterName: name, allowance });
  const p = await submitPayment(deps, {
    spenderId: id,
    money: gbp(1200),
    payee: { name: "Boots", isNew: false },
    category: "health",
    method: "paypal_order",
    context: "Prescription",
  });
  return { hh, p };
}

describe("households", () => {
  it("never shows one household's payments to another", async () => {
    const a = await householdWithPayment("a");
    const b = await householdWithPayment("b");
    const listA = await listPayments(db, a.hh.id);
    expect(listA.map((p) => p.id)).toEqual([a.p.id]);
    expect(await getPayment(db, b.p.id, a.hh.id)).toBeNull();
    expect((await getPayment(db, b.p.id, b.hh.id))?.id).toBe(b.p.id);
  });

  it("gives every demo visitor their own family with fresh ids", async () => {
    const one = await createDemoHousehold(db);
    const two = await createDemoHousehold(db);
    expect(one.id).not.toBe(two.id);
    expect(one.demo).toBe(true);
    const s1 = await listSpenders(db, one.id);
    const s2 = await listSpenders(db, two.id);
    expect(s1.map((s) => s.name).sort()).toEqual(["Gran", "Leo", "Shopping agent"]);
    expect(s2).toHaveLength(3);
    expect(s1.some((s) => s2.some((t) => t.id === s.id))).toBe(false);
  });

  it("cleans up old demo households but never real ones", async () => {
    const demo = await createDemoHousehold(db);
    const real = await createHousehold(db, { name: "Real", spotterName: "Real" });
    await db.query("update households set created_at = now() - interval '3 days'");
    expect(await deleteStaleDemoHouseholds(db, 48)).toBe(1);
    expect(await getHousehold(db, demo.id)).toBeNull();
    expect(await getHousehold(db, real.id)).not.toBeNull();
  });

  it("is a family unless it says it's a business", async () => {
    expect((await createHousehold(db, { name: "F", spotterName: "F" })).kind).toBe("family");
    const biz = await createHousehold(db, { name: "B", spotterName: "B", kind: "business" });
    expect(biz.kind).toBe("business");
    expect((await getHousehold(db, biz.id))?.kind).toBe("business");
    expect((await createDemoHousehold(db)).kind).toBe("family");
  });
});
