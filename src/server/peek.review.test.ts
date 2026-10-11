// Review 2026-10-11 (docs/reviews/code-2026-10-11.md). These tests describe the behaviour the code should have;
// each one fails on the reviewed commit to prove a finding.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, submitPayment, type Deps } from "@/core/lifecycle";
import { PEEK, startPeek, type PeekKernel } from "./peek";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(500), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const SHOP = "https://gadgetbarn.example/deal";

let db: Db;
let hh: string;
let paymentId: string;
let n = 0;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Aivaras" })).id;
  await createSpender(db, { id: "agent", householdId: hh, name: "Shopping agent", kind: "agent", spotterName: "Aivaras", allowance });
  const deps: Deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A9", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  paymentId = (
    await submitPayment(deps, { spenderId: "agent", money: gbp(1999), payee: { name: "GadgetBarn", isNew: true }, category: "electronics", method: "paypal_order", context: `Buy at ${SHOP}` })
  ).id;
  const c = { status: "done", verdict: "likely_scam", headline: "h", findings: [], ask: [], calls: [], dropped: 0, model: "m", ms: 1, page: { url: SHOP, finalUrl: SHOP, title: "t", asks: { card: false, login: false, giftCard: false } } };
  await db.query("update payments set case_file = $2 where id = $1", [paymentId, JSON.stringify(c)]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("review: peek caps", () => {
  it("counts a start whose cloud browser was really created towards the daily cap, even when it arrived too late", async () => {
    // KERNEL is slow (or the start_url is a slow page the payer controls): every browser is created, but after our wait.
    const k = {
      browsers: {
        create: vi.fn(() => new Promise<{ session_id: string }>((r) => setTimeout(() => r({ session_id: `sess_${++n}` }), 40))),
        deleteByID: vi.fn(async () => undefined),
        computer: { captureScreenshot: vi.fn(), scroll: vi.fn() },
      },
    } satisfies PeekKernel;
    for (let i = 0; i < PEEK.perHouseholdDaily + 3; i++) {
      await startPeek(db, hh, paymentId, "desktop", { kernel: k as unknown as PeekKernel, isPublicHost: async () => true, createMs: 5 });
      await new Promise((r) => setTimeout(r, 60)); // let the late browser arrive (and be deleted)
    }
    // Each of these was a billed KERNEL browser. The cap ("3 a day per household") should hold.
    expect(k.browsers.create.mock.calls.length).toBeLessThanOrEqual(PEEK.perHouseholdDaily);
  });
});
