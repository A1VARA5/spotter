// Review 2026-10-11 (docs/reviews/code-2026-10-11.md). Fails on the reviewed commit to prove a finding.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb, type Db } from "@/db";
import { createSpender, getPayment, submitPayment, type Deps } from "@/core/lifecycle";
import type { Allowance } from "@/core/types";
import { handlePayPalEvent, type PayPalEvent } from "./webhook";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance: Omit<Allowance, "spentThisWeek"> = { weekly: gbp(100000), askAbove: gbp(2000), blockedCategories: [], allowedPayees: ["Clay & Kiln"], blockedPayees: [] };

let db: Db;
let deps: Deps;

beforeEach(async () => {
  db = await pgliteDb();
  deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Looks fine.", injectionAttempt: false })),
    confirmed: vi.fn(async () => {}),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O1", authorizationId: "A1", expiresAt: "2026-11-08T10:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C9", status: "PENDING" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  const hh = await createHousehold(db, { name: "Test", spotterName: "Aivaras" });
  await createSpender(db, { householdId: hh.id, id: "gran", name: "Gran", kind: "person", spotterName: "Aivaras", allowance });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

let n = 0;
const capture = (type: string, status: string): PayPalEvent => ({
  id: `WH-R-${++n}`,
  event_type: type,
  resource: { id: "C9", status, supplementary_data: { related_ids: { order_id: "O1", authorization_id: "A1" } } },
});

describe("review: PayPal capture events out of order", () => {
  it("a late PAYMENT.CAPTURE.PENDING for a capture PayPal already DECLINED doesn't turn the payment back into 'paid'", async () => {
    const p = await submitPayment(deps, { spenderId: "gran", money: gbp(2499), payee: { name: "Clay & Kiln", isNew: false }, category: "gifts", method: "paypal_order", context: "A mug" });
    // The capture call went out and PayPal answered PENDING (capture C9), so Spotter shows it as paid.
    await db.query("update payments set status = 'captured', paypal_capture_id = 'C9' where id = $1", [p.id]);
    // PayPal declines C9. PayPal doesn't promise delivery order: the PENDING notice failed its first delivery and is retried later.
    await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.DECLINED", "DECLINED"));
    expect((await getPayment(db, p.id))!.status).toBe("failed");
    await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.PENDING", "PENDING"));
    // Nothing was paid: the decline for C9 is final. Spotter must not say the money moved.
    expect((await getPayment(db, p.id))!.status).toBe("failed");
  });
});
