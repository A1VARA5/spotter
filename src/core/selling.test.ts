import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb } from "@/db";
import { createSpender, type Deps } from "@/core/lifecycle";
import type { AiCheckResult } from "@/ai/check";
import { decideRefund, guardShipment, listRefunds, recordSale, refundConfirmed, requestRefund, scopedGetRefund, sellCreateOrder, sellPayOrder, type Run } from "./selling";

const clean = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false });
const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
let deps: Deps;
let hh: string;
let otherHh: string;
let warn: ReturnType<typeof vi.fn<NonNullable<Deps["warn"]>>>;

// PayPal's get_order for a paid sale (Orders v2 shape), as the toolkit returns it.
const paidOrder = (orderId: string, captureId: string, value = "50.00", currency = "GBP", refunds: Array<{ value: string }> = []) =>
  JSON.stringify({
    id: orderId,
    status: "COMPLETED",
    purchase_units: [
      {
        payments: {
          captures: [{ id: captureId, status: "COMPLETED", amount: { currency_code: currency, value } }],
          ...(refunds.length ? { refunds: refunds.map((r, i) => ({ id: `R${i}`, status: "COMPLETED", amount: { currency_code: currency, value: r.value } })) } : {}),
        },
      },
    ],
  });
const unpaidOrder = (orderId: string) => JSON.stringify({ id: orderId, status: "CREATED", purchase_units: [{}] });

let orders: Record<string, string>;
let run: ReturnType<typeof vi.fn<Run>>;

beforeEach(async () => {
  const db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  otherHh = (await createHousehold(db, { name: "Other family", spotterName: "Kim" })).id;
  const allowance = { weekly: gbp(40000), askAbove: gbp(3000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
  await createSpender(db, { householdId: hh, id: "seller", name: "Leo's selling agent", kind: "agent", spotterName: "Sam", allowance });
  await createSpender(db, { householdId: otherHh, id: "theirs", name: "Their agent", kind: "agent", spotterName: "Kim", allowance });
  await db.query("update spenders set agent_job = 'selling'");
  await recordSale(db, { householdId: hh, spenderId: "seller", orderId: "1AB23456CD789012E", captureId: "2GG279541U471931P", amount: 5000, currency: "GBP", item: "Trainers, size 9", example: true });
  await recordSale(db, { householdId: hh, spenderId: "seller", orderId: "9ZZ23456CD789012E", captureId: null, amount: 3000, currency: "GBP", item: "Jacket", example: true });
  await recordSale(db, { householdId: otherHh, spenderId: "theirs", orderId: "7QQ23456CD789012E", captureId: "8HH279541U471931P", amount: 9000, currency: "GBP", item: "Phone", example: true });
  orders = {
    "1AB23456CD789012E": paidOrder("1AB23456CD789012E", "2GG279541U471931P"),
    "9ZZ23456CD789012E": unpaidOrder("9ZZ23456CD789012E"),
    "7QQ23456CD789012E": paidOrder("7QQ23456CD789012E", "8HH279541U471931P", "90.00"),
  };
  run = vi.fn<Run>(async (method, args) => {
    if (method === "get_order") return orders[String(args.id)] ?? JSON.stringify({ error: { message: "not found", type: "paypal_error" } });
    if (method === "create_refund") return JSON.stringify({ id: "3RF12345AB678901C", status: "COMPLETED" });
    if (method === "create_shipment_tracking") return JSON.stringify({ tracker_identifiers: [{ transaction_id: args.transaction_id, tracking_number: args.tracking_number }] });
    if (method === "get_refund") return JSON.stringify({ id: args.refund_id, status: "COMPLETED" });
    if (method === "create_order") return JSON.stringify({ id: "4NEW3456CD789012E", status: "CREATED", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=4NEW" }] });
    if (method === "pay_order") return JSON.stringify({ status: "success", response: { id: args.id, status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "5CAP79541U471931P", status: "COMPLETED", amount: { currency_code: "USD", value: "25.00" } }] } }] } });
    throw new Error(`unexpected ${method}`);
  });
  warn = vi.fn<NonNullable<Deps["warn"]>>(async () => {});
  deps = {
    db,
    check: vi.fn<Deps["check"]>(async () => clean()),
    warn,
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "X", authorizationId: "A1" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
});

const parse = (s: string) => JSON.parse(s) as { status?: string; id?: string; error?: { message: string }; spotter?: { message: string }; refund_request_id?: string };

describe("create_refund from a selling agent", () => {
  it("never runs directly: it becomes a held refund request and the spotter is told", async () => {
    const r = parse(await requestRefund(deps, run, "seller", { capture_id: "2GG279541U471931P", amount: { currency_code: "GBP", value: "50.00" } }));
    expect(r.status).toBe("HELD_FOR_APPROVAL");
    expect(r.spotter?.message).toMatch(/Sam/);
    expect(run).not.toHaveBeenCalledWith("create_refund", expect.anything());
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1].kind).toBe("refund_held");
    const [req] = await listRefunds(deps.db, hh);
    expect(req).toMatchObject({ status: "held", amount: 5000, paid: 5000, currency: "GBP" });
  });

  it("with no amount asks for what is left of the capture", async () => {
    await requestRefund(deps, run, "seller", { capture_id: "2GG279541U471931P" });
    const [req] = await listRefunds(deps.db, hh);
    expect(req!.amount).toBe(5000);
  });

  it("refuses more than the buyer really paid, in the spotter's words, with the overpayment line", async () => {
    const r = parse(await requestRefund(deps, run, "seller", { capture_id: "2GG279541U471931P", amount: { currency_code: "GBP", value: "200.00" } }));
    expect(r.status).toBe("REFUSED");
    const [req] = await listRefunds(deps.db, hh);
    expect(req!.status).toBe("refused");
    expect(req!.reason).toBe("They paid £50.00. They're asking for £200.00 back. This is how the overpayment scam works.");
    expect(String(warn.mock.calls[0]![1].text)).toContain("They paid £50.00. They're asking for £200.00 back.");
  });

  it("counts refunds PayPal already made against what's left", async () => {
    orders["1AB23456CD789012E"] = paidOrder("1AB23456CD789012E", "2GG279541U471931P", "50.00", "GBP", [{ value: "40.00" }]);
    const r = parse(await requestRefund(deps, run, "seller", { capture_id: "2GG279541U471931P", amount: { currency_code: "GBP", value: "20.00" } }));
    expect(r.status).toBe("REFUSED");
  });

  it("only for a payment Spotter took for this family: never another family's capture or a made up one", async () => {
    for (const capture_id of ["8HH279541U471931P", "9XX279541U471931P"]) {
      const r = parse(await requestRefund(deps, run, "seller", { capture_id }));
      expect(r.error?.message).toMatch(/only refund a payment Spotter took for this family/);
    }
    expect(run).not.toHaveBeenCalled();
    expect(await listRefunds(deps.db, hh)).toHaveLength(0);
  });

  it("refuses a currency that isn't the one the buyer paid in", async () => {
    const r = parse(await requestRefund(deps, run, "seller", { capture_id: "2GG279541U471931P", amount: { currency_code: "USD", value: "10.00" } }));
    expect(r.error?.message).toMatch(/GBP/);
  });

  it("a frozen agent can't ask", async () => {
    await deps.db.query("update spenders set frozen_at = now() where id = 'seller'");
    const r = parse(await requestRefund(deps, run, "seller", { capture_id: "2GG279541U471931P" }));
    expect(r.error?.message).toMatch(/paused/);
  });
});

describe("the spotter decides a refund", () => {
  const held = async () => {
    await requestRefund(deps, run, "seller", { capture_id: "2GG279541U471931P", amount: { currency_code: "GBP", value: "20.00" }, note_to_payer: "Sorry, wrong size" });
    return (await listRefunds(deps.db, hh))[0]!;
  };

  it("approving runs the toolkit's real create_refund on the original capture, for the checked amount only", async () => {
    const req = await held();
    const r = await decideRefund(deps, run, hh, req.id, "approve", "Sam");
    expect(r.ok).toBe(true);
    expect(run).toHaveBeenCalledWith("create_refund", { capture_id: "2GG279541U471931P", amount: { currency_code: "GBP", value: "20.00" }, note_to_payer: "Sorry, wrong size" }, { requestId: `refund-${req.id}` });
    const [after] = await listRefunds(deps.db, hh);
    expect(after).toMatchObject({ status: "refunded", paypal_refund_id: "3RF12345AB678901C", decided_by: "Sam" });
  });

  it("a double tap refunds once", async () => {
    const req = await held();
    await Promise.all([decideRefund(deps, run, hh, req.id, "approve", "Sam"), decideRefund(deps, run, hh, req.id, "approve", "Sam")]);
    expect(run.mock.calls.filter(([m]) => m === "create_refund")).toHaveLength(1);
  });

  it("checks PayPal again at approval: a refund made meanwhile stops it", async () => {
    const req = await held();
    orders["1AB23456CD789012E"] = paidOrder("1AB23456CD789012E", "2GG279541U471931P", "50.00", "GBP", [{ value: "45.00" }]);
    const r = await decideRefund(deps, run, hh, req.id, "approve", "Sam");
    expect(r.ok).toBe(false);
    expect(run).not.toHaveBeenCalledWith("create_refund", expect.anything());
  });

  it("denying never calls PayPal, and another family can't decide it", async () => {
    const req = await held();
    expect((await decideRefund(deps, run, otherHh, req.id, "approve", "Kim")).ok).toBe(false);
    expect((await decideRefund(deps, run, hh, req.id, "deny", "Sam")).ok).toBe(true);
    expect(run).not.toHaveBeenCalledWith("create_refund", expect.anything());
    expect((await listRefunds(deps.db, hh))[0]!.status).toBe("denied");
  });

  it("a PayPal error marks it failed with PayPal's words, nothing claimed as refunded", async () => {
    const req = await held();
    run.mockImplementationOnce(async () => orders["1AB23456CD789012E"]!).mockImplementationOnce(async () => JSON.stringify({ error: { message: "CAPTURE_FULLY_REFUNDED", type: "paypal_error" } }));
    const r = await decideRefund(deps, run, hh, req.id, "approve", "Sam");
    expect(r.ok).toBe(false);
    expect((await listRefunds(deps.db, hh))[0]).toMatchObject({ status: "failed", error: expect.stringContaining("CAPTURE_FULLY_REFUNDED") });
  });

  it("the toolkit's own error shape (an LlmError, ok false) is a failure, never a refund", async () => {
    const req = await held();
    run.mockImplementationOnce(async () => orders["1AB23456CD789012E"]!).mockImplementationOnce(async () =>
      JSON.stringify({ ok: false, status: 422, code: "PAYPAL_API_HTTP_ERROR", message: "The refund amount must be less than or equal to the capture amount" }),
    );
    const r = await decideRefund(deps, run, hh, req.id, "approve", "Sam");
    expect(r.ok).toBe(false);
    expect((await listRefunds(deps.db, hh))[0]).toMatchObject({ status: "failed", paypal_refund_id: null, error: expect.stringContaining("less than or equal") });
  });

  it("no answer from PayPal leaves it as unknown (refunding), not failed and not refunded", async () => {
    const req = await held();
    run.mockImplementationOnce(async () => orders["1AB23456CD789012E"]!).mockImplementationOnce(async () =>
      JSON.stringify({ ok: false, code: "PAYPAL_API_NO_RESPONSE", message: "timeout of 15000ms exceeded" }),
    );
    const r = await decideRefund(deps, run, hh, req.id, "approve", "Sam");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/check PayPal/i);
    expect((await listRefunds(deps.db, hh))[0]).toMatchObject({ status: "refunding", paypal_refund_id: null });
  });

  it("a refund PayPal answers without an id, or as FAILED, isn't called refunded", async () => {
    const req = await held();
    run.mockImplementationOnce(async () => orders["1AB23456CD789012E"]!).mockImplementationOnce(async () => JSON.stringify({ id: "3RF12345AB678901C", status: "FAILED" }));
    expect((await decideRefund(deps, run, hh, req.id, "approve", "Sam")).ok).toBe(false);
    expect((await listRefunds(deps.db, hh))[0]!.status).toBe("failed");
  });

  it("PayPal's PAYMENT.CAPTURE.REFUNDED webhook confirms it", async () => {
    const req = await held();
    await decideRefund(deps, run, hh, req.id, "approve", "Sam");
    expect(await refundConfirmed(deps.db, "3RF12345AB678901C")).toBe(true);
    expect((await listRefunds(deps.db, hh))[0]!.confirmed_at).not.toBeNull();
    expect(await refundConfirmed(deps.db, "NOTOURS12345678")).toBe(false);
  });

  it("get_refund only reads refunds Spotter made for this agent's family", async () => {
    const req = await held();
    await decideRefund(deps, run, hh, req.id, "approve", "Sam");
    expect(parse(await scopedGetRefund(deps, run, "seller", "3RF12345AB678901C")).status).toBe("COMPLETED");
    expect(parse(await scopedGetRefund(deps, run, "theirs", "3RF12345AB678901C")).error).toBeTruthy();
  });
});

describe("create_shipment_tracking: paid? prove it", () => {
  it("adds tracking through the toolkit once PayPal shows a completed capture for that sale", async () => {
    const r = parse(await guardShipment(deps, run, "seller", { order_id: "1AB23456CD789012E", transaction_id: "2GG279541U471931P", tracking_number: "RM123456789GB", carrier: "ROYAL_MAIL" }));
    expect(r.error).toBeUndefined();
    expect(run).toHaveBeenCalledWith("create_shipment_tracking", expect.objectContaining({ transaction_id: "2GG279541U471931P", tracking_number: "RM123456789GB" }));
  });

  it("refuses an order PayPal shows no payment for, whatever an email says", async () => {
    const r = parse(await guardShipment(deps, run, "seller", { order_id: "9ZZ23456CD789012E", transaction_id: "6FAKE9541U471931P", tracking_number: "RM1" }));
    expect(r.error?.message).toMatch(/Paid\? Prove it/);
    expect(run).not.toHaveBeenCalledWith("create_shipment_tracking", expect.anything());
  });

  it("a PayPal outage isn't reported as unpaid", async () => {
    run.mockImplementationOnce(async () => JSON.stringify({ ok: false, code: "PAYPAL_API_NO_RESPONSE", message: "timeout" }));
    const r = parse(await guardShipment(deps, run, "seller", { order_id: "1AB23456CD789012E", transaction_id: "2GG279541U471931P", tracking_number: "RM1" }));
    expect(r.error?.message).toMatch(/couldn't reach PayPal/i);
    expect(r.error?.message).not.toMatch(/Prove it/);
  });

  it("refuses another family's sale and a transaction id that isn't the sale's capture", async () => {
    expect(parse(await guardShipment(deps, run, "seller", { transaction_id: "8HH279541U471931P", tracking_number: "RM1" })).error).toBeTruthy();
    expect(parse(await guardShipment(deps, run, "seller", { order_id: "1AB23456CD789012E", transaction_id: "8HH279541U471931P", tracking_number: "RM1" })).error).toBeTruthy();
    expect(run).not.toHaveBeenCalledWith("create_shipment_tracking", expect.anything());
  });
});

describe("a selling agent's own orders", () => {
  it("create_order makes a real toolkit order for the buyer and records it as this family's sale", async () => {
    const r = parse(await sellCreateOrder(deps, run, "seller", { currencyCode: "USD", items: [{ name: "Cap", quantity: 1, itemCost: 25, taxPercent: 0, itemTotal: 25 }] }));
    expect(r.id).toBe("4NEW3456CD789012E");
    const [sale] = await deps.db.query<{ amount: string; household_id: string }>("select amount, household_id from sales where paypal_order_id = '4NEW3456CD789012E'");
    expect(sale).toMatchObject({ household_id: hh });
    expect(Number(sale!.amount)).toBe(2500);
  });

  it("create_order sends a PayPal-Request-Id made from the sale row's id", async () => {
    await sellCreateOrder(deps, run, "seller", { currencyCode: "USD", items: [{ name: "Cap", quantity: 1, itemCost: 25, taxPercent: 0, itemTotal: 25 }] });
    const [sale] = await deps.db.query<{ id: string }>("select id from sales where paypal_order_id = '4NEW3456CD789012E'");
    expect(run).toHaveBeenCalledWith("create_order", expect.anything(), { requestId: `order-${sale!.id}` });
  });

  it("pay_order takes the buyer's payment only for this family's sale, and records the capture", async () => {
    await sellCreateOrder(deps, run, "seller", { currencyCode: "USD", items: [{ name: "Cap", quantity: 1, itemCost: 25, taxPercent: 0, itemTotal: 25 }] });
    expect(parse(await sellPayOrder(deps, run, "theirs", "4NEW3456CD789012E")).error).toBeTruthy();
    await sellPayOrder(deps, run, "seller", "4NEW3456CD789012E");
    const [sale] = await deps.db.query<{ capture_id: string }>("select capture_id from sales where paypal_order_id = '4NEW3456CD789012E'");
    expect(sale!.capture_id).toBe("5CAP79541U471931P");
    expect(run).toHaveBeenCalledWith("pay_order", { id: "4NEW3456CD789012E" }, { requestId: expect.stringMatching(/^capture-sale_/) });
  });
});
