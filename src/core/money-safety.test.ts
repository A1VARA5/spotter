// Money safety on PayPal failure paths: a hold Spotter can't confirm released (or paid) is never left behind
// marked "failed". It stays in voiding/capturing, and the reconcile job (or a manual retry) asks PayPal and finishes it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb, type Db } from "@/db";
import { approve, createSpender, deny, getPayment, listEvents, reconcileStuck, retryWithPayPal, submitPayment, withdraw, type Deps } from "./lifecycle";
import { springTripwire } from "./tripwire";
import type { AiCheckResult } from "@/ai/check";
import { PayPalError } from "@/paypal/client";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(2000), blockedCategories: [], allowedPayees: ["Clay & Kiln"], blockedPayees: [] };
const cleanAi = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false });

type P = Deps["paypal"];
let db: Db;
let deps: Deps;
let create: ReturnType<typeof vi.fn<P["createAuthorizeOrder"]>>;
let capture: ReturnType<typeof vi.fn<P["captureAuthorization"]>>;
let voidAuth: ReturnType<typeof vi.fn<P["voidAuthorization"]>>;
let lookup: ReturnType<typeof vi.fn<NonNullable<P["getAuthorization"]>>>;

beforeEach(async () => {
  db = await pgliteDb();
  create = vi.fn<P["createAuthorizeOrder"]>(async () => ({ orderId: "O1", authorizationId: "A1" }));
  capture = vi.fn<P["captureAuthorization"]>(async () => ({ captureId: "C1", status: "COMPLETED" }));
  voidAuth = vi.fn<P["voidAuthorization"]>(async () => ({ status: "VOIDED" }));
  lookup = vi.fn<NonNullable<P["getAuthorization"]>>(async () => ({ status: "CREATED" }));
  deps = { db, check: vi.fn(async () => cleanAi()), paypal: { createAuthorizeOrder: create, captureAuthorization: capture, voidAuthorization: voidAuth, getAuthorization: lookup } };
  const hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  await createSpender(db, { householdId: hh, id: "agent1", name: "Shopping agent", kind: "agent", spotterName: "Sam", allowance });
});

const held = () =>
  submitPayment(deps, { spenderId: "agent1", money: gbp(2500), payee: { name: "Clay & Kiln", isNew: false }, category: "gifts", method: "paypal_order", context: "Mug" });
const age = (id: string) => db.query("update payments set updated_at = now() - interval '10 minutes' where id = $1", [id]);

describe("PayPal-Request-Id on every money call", () => {
  it("void and capture keys come from the payment and its authorisation", async () => {
    const a = await held();
    await deny(deps, a.id, "Sam");
    expect(voidAuth).toHaveBeenCalledWith("A1", `void-${a.id}-A1`);
    const b = await held();
    await approve(deps, b.id, "Sam");
    expect(capture).toHaveBeenCalledWith("A1", `capture-${b.id}-A1`);
  });
});

describe("a void PayPal didn't confirm", () => {
  it("stays voiding with the reason, never 'failed' with a live hold", async () => {
    const p = await held();
    voidAuth.mockRejectedValueOnce(new PayPalError("timeout", 0, "TIMEOUT"));
    const after = await deny(deps, p.id, "Sam");
    expect(after.status).toBe("voiding");
    expect(after.error).toMatch(/PayPal didn't confirm/i);
    expect((await listEvents(db, p.id)).map((e) => e.type)).toContain("void_unconfirmed");
  });

  it("withdraw behaves the same", async () => {
    const p = await held();
    voidAuth.mockRejectedValueOnce(new PayPalError("server", 503, "INTERNAL_SERVICE_ERROR"));
    expect((await withdraw(deps, p.id, "agent")).status).toBe("voiding");
  });

  it("reconcile asks PayPal: a hold still there is voided again with the same key, then the payment is voided", async () => {
    const p = await held();
    voidAuth.mockRejectedValueOnce(new Error("network"));
    await deny(deps, p.id, "Sam");
    await age(p.id);
    expect(await reconcileStuck(deps)).toBe(1);
    expect(voidAuth).toHaveBeenLastCalledWith("A1", `void-${p.id}-A1`);
    const now = await getPayment(db, p.id);
    expect(now?.status).toBe("voided");
    expect(now?.error).toBeNull();
  });

  it("reconcile settles a hold PayPal already let go without calling void again", async () => {
    const p = await held();
    voidAuth.mockRejectedValueOnce(new Error("network"));
    await deny(deps, p.id, "Sam");
    await age(p.id);
    lookup.mockResolvedValueOnce({ status: "VOIDED" });
    await reconcileStuck(deps);
    expect(voidAuth).toHaveBeenCalledTimes(1);
    expect((await getPayment(db, p.id))?.status).toBe("voided");
  });

  it("a second failed void leaves it voiding for the next run", async () => {
    const p = await held();
    voidAuth.mockRejectedValue(new Error("network"));
    await deny(deps, p.id, "Sam");
    await age(p.id);
    expect(await reconcileStuck(deps)).toBe(0);
    expect((await getPayment(db, p.id))?.status).toBe("voiding");
  });

  it("PayPal saying it was captured is recorded as captured with a mismatch, never hidden", async () => {
    const p = await held();
    voidAuth.mockRejectedValueOnce(new Error("network"));
    await deny(deps, p.id, "Sam");
    await age(p.id);
    lookup.mockResolvedValueOnce({ status: "CAPTURED" });
    await reconcileStuck(deps);
    expect((await getPayment(db, p.id))?.status).toBe("captured");
    expect((await listEvents(db, p.id)).map((e) => e.type)).toContain("paypal_mismatch");
  });

  it("a manual retry finishes it straight away, whatever its age, and only for its own household", async () => {
    const p = await held();
    voidAuth.mockRejectedValueOnce(new Error("network"));
    await deny(deps, p.id, "Sam");
    expect(await retryWithPayPal(deps, p.id, "hh_other")).toMatchObject({ ok: false, status: 404 });
    const [{ household_id }] = (await db.query<{ household_id: string }>("select household_id from spenders where id = 'agent1'")) as [{ household_id: string }];
    const r = await retryWithPayPal(deps, p.id, household_id);
    expect(r).toMatchObject({ ok: true });
    expect((await getPayment(db, p.id))?.status).toBe("voided");
  });
});

describe("a capture PayPal refused or didn't answer", () => {
  it("a 4xx with the hold still live goes back to the spotter with PayPal's reason", async () => {
    const p = await held();
    capture.mockRejectedValueOnce(new PayPalError("declined", 422, "INSTRUMENT_DECLINED"));
    const after = await approve(deps, p.id, "Sam");
    expect(after.status).toBe("needs_approval");
    expect(after.error).toContain("INSTRUMENT_DECLINED");
  });

  it("a 4xx with the hold gone ends failed (nothing held, nothing paid)", async () => {
    const p = await held();
    capture.mockRejectedValueOnce(new PayPalError("expired", 422, "AUTHORIZATION_EXPIRED"));
    lookup.mockResolvedValueOnce({ status: "EXPIRED" });
    expect((await approve(deps, p.id, "Sam")).status).toBe("failed");
  });

  it("a timeout or 5xx stays capturing for reconcile, which captures with the same key", async () => {
    const p = await held();
    capture.mockRejectedValueOnce(new PayPalError("server", 503, "INTERNAL_SERVICE_ERROR"));
    const after = await approve(deps, p.id, "Sam");
    expect(after.status).toBe("capturing");
    expect(after.error).toMatch(/PayPal didn't confirm/i);
    await age(p.id);
    await reconcileStuck(deps);
    expect(capture).toHaveBeenLastCalledWith("A1", `capture-${p.id}-A1`);
    expect((await getPayment(db, p.id))?.status).toBe("captured");
  });

  it("PENDING at PayPal means PayPal is still reviewing: it stays capturing", async () => {
    const p = await held();
    capture.mockRejectedValueOnce(new Error("network"));
    await approve(deps, p.id, "Sam");
    await age(p.id);
    lookup.mockResolvedValueOnce({ status: "PENDING" });
    await reconcileStuck(deps);
    expect((await getPayment(db, p.id))?.status).toBe("capturing");
  });
});

describe("the tripwire race", () => {
  it("a hold PayPal makes while the agent is being frozen is voided too", async () => {
    // The order passed the frozen check, then the tripwire springs while PayPal is still making the hold.
    create.mockImplementationOnce(async () => {
      await springTripwire(deps, "agent1", "create_refund", {});
      return { orderId: "O2", authorizationId: "A2" };
    });
    const p = await held();
    expect(p.status).toBe("voided");
    expect(voidAuth).toHaveBeenCalledWith("A2", `void-${p.id}-A2`);
  });

  it("a payment Spotter would pay at once is never captured once the agent is frozen", async () => {
    create.mockImplementationOnce(async () => {
      await springTripwire(deps, "agent1", "create_refund", {});
      return { orderId: "O3", authorizationId: "A3" };
    });
    const p = await submitPayment(deps, { spenderId: "agent1", money: gbp(500), payee: { name: "Clay & Kiln", isNew: false }, category: "gifts", method: "paypal_order", context: "Mug" });
    expect(capture).not.toHaveBeenCalled();
    expect(p.status).toBe("voided");
  });
});

describe("review fixes: never a live hold marked failed, never a wrong 'nothing was paid'", () => {
  it("a database hiccup after the hold is saved keeps the hold in front of the spotter, never 'failed'", async () => {
    let made = false;
    create.mockImplementationOnce(async () => {
      made = true;
      return { orderId: "O5", authorizationId: "A5" };
    });
    const real = db.query.bind(db);
    let thrown = false;
    deps = {
      ...deps,
      db: {
        query: (async (sql: string, params?: unknown[]) => {
          if (made && !thrown && sql.startsWith("select * from spenders where id")) {
            thrown = true;
            throw new Error("connection reset");
          }
          return real(sql, params);
        }) as Db["query"],
      },
    };
    const p = await held();
    expect(p.status).toBe("needs_approval");
    expect(p.paypal_authorization_id).toBe("A5");
    expect(p.error).toMatch(/connection reset/);
  });

  it("a firm void refusal asks PayPal at once: already captured is shown as captured, not 'nothing was paid'", async () => {
    const p = await held();
    voidAuth.mockRejectedValueOnce(new PayPalError("already captured", 422, "AUTHORIZATION_ALREADY_CAPTURED"));
    lookup.mockResolvedValueOnce({ status: "CAPTURED" });
    const after = await deny(deps, p.id, "Sam");
    expect(after.status).toBe("captured");
    expect((await listEvents(db, p.id)).map((e) => e.type)).toContain("paypal_mismatch");
  });

  it("a manual retry that sends the payment back to the spotter says so (ok), not 'still hasn't confirmed'", async () => {
    const p = await held();
    capture.mockRejectedValueOnce(new Error("network"));
    await approve(deps, p.id, "Sam");
    capture.mockRejectedValueOnce(new PayPalError("declined", 422, "INSTRUMENT_DECLINED"));
    const [{ household_id }] = (await db.query<{ household_id: string }>("select household_id from spenders where id = 'agent1'")) as [{ household_id: string }];
    const r = await retryWithPayPal(deps, p.id, household_id);
    expect(r).toMatchObject({ ok: true, payment: { status: "needs_approval" } });
  });

  it("an approved payment whose hold lapsed at PayPal says so plainly", async () => {
    const p = await held();
    capture.mockRejectedValueOnce(new Error("network"));
    await approve(deps, p.id, "Sam");
    await age(p.id);
    lookup.mockResolvedValueOnce({ status: "EXPIRED" });
    await reconcileStuck(deps);
    const now = await getPayment(db, p.id);
    expect(now?.status).toBe("voided");
    expect(now?.error).toMatch(/lapse/i);
  });

  it("reconcile never finishes the capture of a frozen agent's hold", async () => {
    capture.mockRejectedValueOnce(new Error("network"));
    const p = await submitPayment(deps, { spenderId: "agent1", money: gbp(500), payee: { name: "Clay & Kiln", isNew: false }, category: "gifts", method: "paypal_order", context: "Mug" });
    expect(p.status).toBe("capturing");
    await db.query("update spenders set frozen_at = now() where id = 'agent1'");
    await age(p.id);
    await reconcileStuck(deps);
    expect(capture).toHaveBeenCalledTimes(1);
    expect((await getPayment(db, p.id))?.status).toBe("voided");
  });

  it("PayPal saying the same request is still in progress is not a refusal: it stays capturing", async () => {
    const p = await held();
    capture.mockRejectedValueOnce(new PayPalError("in progress", 409, "PREVIOUS_REQUEST_IN_PROGRESS"));
    expect((await approve(deps, p.id, "Sam")).status).toBe("capturing");
  });
});

describe("PayPal's record of which agent key asked", () => {
  it("an agent order carries custom_id with the key and the payment id", async () => {
    const p = await submitPayment(deps, {
      spenderId: "agent1",
      money: gbp(2500),
      payee: { name: "Clay & Kiln", isNew: false },
      category: "gifts",
      method: "paypal_order",
      context: "Mug",
      agentKey: "spt-abcd",
    });
    expect(create.mock.calls[0]![1]).toEqual({ source: "card", customId: `spt-abcd:${p.id}` });
  });
});
