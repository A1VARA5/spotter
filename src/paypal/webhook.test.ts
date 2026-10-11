import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb, type Db } from "@/db";
import { createSpender, deny, getPayment, submitPayment, type Deps, type Payment } from "@/core/lifecycle";
import type { AiCheckResult } from "@/ai/check";
import type { Allowance } from "@/core/types";
import { handlePayPalEvent, handleWebhookRequest, type PayPalEvent } from "./webhook";
import { confirmedText } from "@/telegram/notify";
import { PayPalError } from "./client";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance: Omit<Allowance, "spentThisWeek"> = {
  weekly: gbp(100000),
  askAbove: gbp(2000),
  blockedCategories: [],
  allowedPayees: ["Clay & Kiln"],
  blockedPayees: [],
};
const cleanAi = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Looks fine.", injectionAttempt: false });

let db: Db;
let deps: Deps;
type P = Deps["paypal"];
let paypal: {
  create: ReturnType<typeof vi.fn<P["createAuthorizeOrder"]>>;
  capture: ReturnType<typeof vi.fn<P["captureAuthorization"]>>;
  void: ReturnType<typeof vi.fn<P["voidAuthorization"]>>;
};
let confirmed: ReturnType<typeof vi.fn<NonNullable<Deps["confirmed"]>>>;

beforeEach(async () => {
  db = await pgliteDb();
  paypal = {
    create: vi.fn<P["createAuthorizeOrder"]>(async () => ({ orderId: "O1", authorizationId: "A1", expiresAt: "2026-11-08T10:00:00Z" })),
    capture: vi.fn<P["captureAuthorization"]>(async () => ({ captureId: "C1", status: "COMPLETED" })),
    void: vi.fn<P["voidAuthorization"]>(async () => ({ status: "VOIDED" })),
  };
  confirmed = vi.fn<NonNullable<Deps["confirmed"]>>(async () => {});
  deps = {
    db,
    check: vi.fn<Deps["check"]>(async () => cleanAi()),
    confirmed,
    paypal: { createAuthorizeOrder: paypal.create, captureAuthorization: paypal.capture, voidAuthorization: paypal.void },
  };
  const hh = await createHousehold(db, { name: "Test", spotterName: "Aivaras" });
  await createSpender(db, { householdId: hh.id, id: "gran", name: "Gran", kind: "person", spotterName: "Aivaras", allowance });
});

/** A payment PayPal is holding, waiting for the spotter (authorisation A1 on order O1). */
async function held(amount = 2499): Promise<Payment> {
  const p = await submitPayment(deps, {
    spenderId: "gran",
    money: gbp(amount),
    payee: { name: "Clay & Kiln", isNew: false },
    category: "gifts",
    method: "paypal_order",
    context: "A mug",
  });
  expect(p.status).toBe("needs_approval");
  paypal.create.mockClear();
  return p;
}

const setStatus = (id: string, status: string) => db.query("update payments set status = $2 where id = $1", [id, status]);

let n = 0;
const evt = (event_type: string, resource: Record<string, unknown>): PayPalEvent => ({ id: `WH-${++n}`, event_type, resource });
const authCreated = () =>
  evt("PAYMENT.AUTHORIZATION.CREATED", { id: "A1", status: "CREATED", expiration_time: "2026-11-09T12:00:00Z", supplementary_data: { related_ids: { order_id: "O1" } } });
const authVoided = () => evt("PAYMENT.AUTHORIZATION.VOIDED", { id: "A1", status: "VOIDED", supplementary_data: { related_ids: { order_id: "O1" } } });
const capture = (type: string, status: string) =>
  evt(type, { id: "C9", status, supplementary_data: { related_ids: { order_id: "O1", authorization_id: "A1" } } });

const expectNoMoneyMoved = () => {
  expect(paypal.capture).not.toHaveBeenCalled();
  expect(paypal.void).not.toHaveBeenCalled();
  expect(paypal.create).not.toHaveBeenCalled();
};

describe("PayPal webhook events", () => {
  it("stores the authorisation expiry from the hold itself", async () => {
    const p = await held();
    const [row] = await db.query<{ paypal_auth_expires_at: Date }>("select paypal_auth_expires_at from payments where id = $1", [p.id]);
    expect(new Date(row!.paypal_auth_expires_at).toISOString()).toBe("2026-11-08T10:00:00.000Z");
  });

  it("AUTHORIZATION.CREATED records the expiry and leaves the status alone", async () => {
    const p = await held();
    const r = await handlePayPalEvent(deps, authCreated());
    expect(r.paymentId).toBe(p.id);
    const [row] = await db.query<{ status: string; paypal_auth_expires_at: Date }>("select status, paypal_auth_expires_at from payments where id = $1", [p.id]);
    expect(row!.status).toBe("needs_approval");
    expect(new Date(row!.paypal_auth_expires_at).toISOString()).toBe("2026-11-09T12:00:00.000Z");
    expectNoMoneyMoved();
  });

  it("CAPTURE.COMPLETED settles a payment stuck in capturing and tells the spotter", async () => {
    const p = await held(21900);
    await setStatus(p.id, "capturing");
    await db.query("update payments set decided_by = 'Aivaras' where id = $1", [p.id]);
    const r = await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.COMPLETED", "COMPLETED"));
    expect(r.outcome).toBe("captured");
    const after = (await getPayment(db, p.id))!;
    expect(after.status).toBe("captured");
    expect(after.paypal_capture_id).toBe("C9");
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed.mock.calls[0]![0].status).toBe("captured");
    expectNoMoneyMoved();
  });

  it("CAPTURE.COMPLETED for a payment already captured by the spotter just confirms it", async () => {
    const p = await held();
    await db.query("update payments set status = 'captured', paypal_capture_id = 'C9', decided_by = 'Aivaras' where id = $1", [p.id]);
    await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.COMPLETED", "COMPLETED"));
    expect((await getPayment(db, p.id))!.status).toBe("captured");
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it("does not ping the spotter for small payments Spotter let through on its own", async () => {
    const p = await submitPayment(deps, { spenderId: "gran", money: gbp(500), payee: { name: "Clay & Kiln", isNew: false }, category: "gifts", method: "paypal_order", context: "" });
    expect(p.status).toBe("captured");
    await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.COMPLETED", "COMPLETED"));
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("CAPTURE.PENDING settles a stuck capture without a confirmation note", async () => {
    const p = await held();
    await setStatus(p.id, "capturing");
    await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.PENDING", "PENDING"));
    expect((await getPayment(db, p.id))!.status).toBe("captured");
    expect(confirmed).not.toHaveBeenCalled();
    expectNoMoneyMoved();
  });

  it("CAPTURE.DENIED marks a capture as failed with the reason", async () => {
    const p = await held();
    await setStatus(p.id, "capturing");
    await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.DENIED", "DECLINED"));
    const after = (await getPayment(db, p.id))!;
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/PayPal denied/);
    expectNoMoneyMoved();
  });

  it("CAPTURE.DECLINED (the Orders v2 name) marks a capture as failed too", async () => {
    const p = await held();
    await setStatus(p.id, "capturing");
    await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.DECLINED", "DECLINED"));
    const after = (await getPayment(db, p.id))!;
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/PayPal denied/);
    expectNoMoneyMoved();
  });

  it("AUTHORIZATION.VOIDED settles a stuck deny and tells the spotter the money went back", async () => {
    const p = await held();
    await setStatus(p.id, "voiding");
    const r = await handlePayPalEvent(deps, authVoided());
    expect(r.outcome).toBe("voided");
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    expect(confirmed).toHaveBeenCalledTimes(1);
    expectNoMoneyMoved();
  });

  it("AUTHORIZATION.VOIDED after a normal deny confirms it", async () => {
    const p = await held();
    await deny(deps, p.id, "Aivaras");
    paypal.void.mockClear();
    await handlePayPalEvent(deps, authVoided());
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    expect(confirmed).toHaveBeenCalledTimes(1);
    expectNoMoneyMoved();
  });

  it("a hold PayPal voided elsewhere can no longer be approved, and nothing is captured", async () => {
    const p = await held();
    await handlePayPalEvent(deps, authVoided());
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    expectNoMoneyMoved();
  });

  it("CAPTURE.REFUNDED and CHECKOUT.ORDER.APPROVED are recorded against the payment without moving it", async () => {
    const p = await held();
    await db.query("update payments set status = 'captured', paypal_capture_id = 'C9' where id = $1", [p.id]);
    const refund = await handlePayPalEvent(
      deps,
      evt("PAYMENT.CAPTURE.REFUNDED", { id: "R1", status: "COMPLETED", links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/C9" }] }),
    );
    const approved = await handlePayPalEvent(deps, evt("CHECKOUT.ORDER.APPROVED", { id: "O1", status: "APPROVED" }));
    expect(refund.paymentId).toBe(p.id);
    expect(approved.paymentId).toBe(p.id);
    expect((await getPayment(db, p.id))!.status).toBe("captured");
    const rows = await db.query<{ event_type: string; payment_id: string }>("select event_type, payment_id from paypal_events order by received_at");
    expect(rows.map((r) => r.event_type)).toEqual(["PAYMENT.CAPTURE.REFUNDED", "CHECKOUT.ORDER.APPROVED"]);
    expectNoMoneyMoved();
  });

  it("CAPTURE.REFUNDED for a refund Spotter sent for a family that sells marks it confirmed by PayPal", async () => {
    const hh = (await db.query<{ id: string }>("select id from households limit 1"))[0]!.id;
    await db.query("insert into sales (id, household_id, paypal_order_id, capture_id, amount, currency, item) values ('sale_1', $1, 'O77', 'C77', 5000, 'GBP', 'Trainers')", [hh]);
    await db.query("insert into refund_requests (id, household_id, sale_id, amount, currency, paid, status, paypal_refund_id) values ('rfd_1', $1, 'sale_1', 2000, 'GBP', 5000, 'refunded', 'R77')", [hh]);
    const e = evt("PAYMENT.CAPTURE.REFUNDED", { id: "R77", status: "COMPLETED", links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/C77" }] });
    const r = await handlePayPalEvent(deps, e);
    expect(r.outcome).toBe("refund_confirmed");
    const [req] = await db.query<{ confirmed_at: string | null }>("select confirmed_at from refund_requests where id = 'rfd_1'");
    expect(req!.confirmed_at).not.toBeNull();
    expect((await handlePayPalEvent(deps, e)).outcome).toBe("duplicate");
    expectNoMoneyMoved();
  });

  it("a capture for a hold Spotter already voided is left alone but marked on the timeline", async () => {
    const p = await held();
    await setStatus(p.id, "voided");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handlePayPalEvent(deps, capture("PAYMENT.CAPTURE.COMPLETED", "COMPLETED"));
    err.mockRestore();
    expect(r.outcome).toBe("mismatch");
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    expect(await db.query("select type from events where payment_id = $1 and type = 'paypal_mismatch'", [p.id])).toHaveLength(1);
    expect(confirmed).not.toHaveBeenCalled();
    expectNoMoneyMoved();
  });

  it("a duplicate event is stored once and acted on once", async () => {
    const p = await held();
    await setStatus(p.id, "voiding");
    const e = authVoided();
    expect((await handlePayPalEvent(deps, e)).outcome).toBe("voided");
    expect((await handlePayPalEvent(deps, e)).outcome).toBe("duplicate");
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(await db.query("select id from paypal_events")).toHaveLength(1);
  });

  it("an event for a payment Spotter doesn't know is stored with no payment", async () => {
    const r = await handlePayPalEvent(deps, evt("PAYMENT.CAPTURE.COMPLETED", { id: "C-OTHER", supplementary_data: { related_ids: { authorization_id: "A-OTHER" } } }));
    expect(r).toEqual({ outcome: "unknown_payment", paymentId: null });
    const [row] = await db.query<{ payment_id: string | null; resource_id: string }>("select payment_id, resource_id from paypal_events");
    expect(row).toEqual({ payment_id: null, resource_id: "C-OTHER" });
  });

  it("a failed notification never breaks the webhook", async () => {
    const p = await held();
    await setStatus(p.id, "voiding");
    confirmed.mockRejectedValueOnce(new Error("Telegram is down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handlePayPalEvent(deps, authVoided())).resolves.toMatchObject({ outcome: "voided" });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("writes the confirmation in plain words", async () => {
    const p = await held(21900);
    const spender = { name: "Gran" } as never;
    expect(confirmedText({ ...p, status: "voided" }, spender)).toContain("PayPal confirmed: £219.00 released back to Gran.");
    expect(confirmedText({ ...p, status: "captured" }, spender)).toContain("PayPal confirmed: £219.00 paid to Clay &amp; Kiln.");
  });
});

describe("PayPal webhook request", () => {
  const raw = JSON.stringify(evt("PAYMENT.AUTHORIZATION.VOIDED", { id: "A1" }));
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "t1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-10-10T12:00:00Z",
  };
  const request = (h: Record<string, string> = headers, body = raw) => new Request("https://x/api/paypal/webhook", { method: "POST", headers: h, body });
  const quiet = () => {
    const spies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {})];
    return () => spies.forEach((s) => s.mockRestore());
  };

  it("fails closed with 503 when PAYPAL_WEBHOOK_ID is not set", async () => {
    const restore = quiet();
    const verify = vi.fn(async () => true);
    const res = await handleWebhookRequest(request(), { webhookId: undefined, verify, deps: async () => deps });
    expect(res.status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
    restore();
  });

  it("rejects missing signature headers without asking PayPal", async () => {
    const restore = quiet();
    const verify = vi.fn(async () => true);
    const res = await handleWebhookRequest(request({}), { webhookId: "WH", verify, deps: async () => deps });
    expect(res.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    restore();
  });

  it("rejects an event PayPal doesn't vouch for, and stores nothing", async () => {
    const restore = quiet();
    const res = await handleWebhookRequest(request(), { webhookId: "WH", verify: async () => false, deps: async () => deps });
    expect(res.status).toBe(401);
    expect(await db.query("select id from paypal_events")).toHaveLength(0);
    restore();
  });

  it("asks PayPal to retry (503) when the verify call itself fails", async () => {
    const restore = quiet();
    const res = await handleWebhookRequest(request(), { webhookId: "WH", verify: async () => { throw new Error("timeout"); }, deps: async () => deps });
    expect(res.status).toBe(503);
    restore();
  });

  it("treats PayPal's verify API refusing the headers (4xx) as not genuine", async () => {
    const restore = quiet();
    const verify = async () => {
      throw new PayPalError("bad request", 400, "VALIDATION_ERROR");
    };
    const res = await handleWebhookRequest(request(), { webhookId: "WH", verify, deps: async () => deps });
    expect(res.status).toBe(401);
    restore();
  });

  it("verifies the raw body with the right headers and stores the event", async () => {
    const restore = quiet();
    const verify = vi.fn(async () => true);
    const res = await handleWebhookRequest(request(), { webhookId: "WH", verify, deps: async () => deps });
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(
      { authAlgo: "SHA256withRSA", certUrl: headers["paypal-cert-url"], transmissionId: "t1", transmissionSig: "sig", transmissionTime: "2026-10-10T12:00:00Z" },
      "WH",
      raw,
    );
    expect(await db.query("select id from paypal_events")).toHaveLength(1);
    restore();
  });

  it("answers 400 to a body that isn't an event", async () => {
    const restore = quiet();
    const res = await handleWebhookRequest(request(headers, "not json"), { webhookId: "WH", verify: async () => true, deps: async () => deps });
    expect(res.status).toBe(400);
    restore();
  });
});
