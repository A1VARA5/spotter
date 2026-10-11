import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb } from "@/db";
import { createSpender, submitPayment, type Deps } from "@/core/lifecycle";
import type { AiCheckResult } from "@/ai/check";
import type { Run } from "./selling";
import { decideSubscription, holdSubscription, listHeldSubscriptions, scopedShowSubscription, subscriptionTail, tailText } from "./subscriptions";

// PayPal's plan shape (GET /v1/billing/plans/{id}), as show_subscription_plan_details returns it.
const plan = (over: Record<string, unknown> = {}) => ({
  id: "P-5ML4271244454362WXNWU5NQ",
  name: "Example: StreamBox Premium (sandbox)",
  status: "ACTIVE",
  billing_cycles: [
    { frequency: { interval_unit: "DAY", interval_count: 7 }, tenure_type: "TRIAL", sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: "0", currency_code: "USD" } } },
    { frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { value: "39.99", currency_code: "USD" } } },
  ],
  payment_preferences: { setup_fee: { value: "0", currency_code: "USD" } },
  ...over,
});

describe("the subscription's tail", () => {
  it("a free trial: nothing now, the first charge in 7 days, then every month, and the first year's total", () => {
    const t = subscriptionTail(plan());
    expect(t).toMatchObject({ currency: "USD", now: 0, next: { inDays: 7, amount: 3999 }, then: { amount: 3999, every: "month", forever: true } });
    expect(t.firstYear).toBe(3999 * 12);
    expect(tailText(t)).toBe("US$0.00 now, US$39.99 in 7 days, then US$39.99 every month until cancelled. US$479.88 in the first year.");
  });

  it("a setup fee and no trial: both charged now", () => {
    const t = subscriptionTail(
      plan({
        billing_cycles: [{ frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 12, pricing_scheme: { fixed_price: { value: "12.50", currency_code: "USD" } } }],
        payment_preferences: { setup_fee: { value: "5.00", currency_code: "USD" } },
      }),
    );
    expect(t.now).toBe(1750);
    expect(t.then).toMatchObject({ amount: 1250, every: "month", forever: false, cycles: 12 });
    expect(t.firstYear).toBe(500 + 1250 * 12);
  });

  it("quantity multiplies the cycle prices", () => {
    expect(subscriptionTail(plan(), 2).then?.amount).toBe(7998);
  });

  it("refuses a plan it can't read rather than guessing", () => {
    expect(() => subscriptionTail({ name: "x", billing_cycles: [] })).toThrow();
    expect(() => subscriptionTail(plan({ billing_cycles: [{ tenure_type: "REGULAR", sequence: 1, frequency: { interval_unit: "MONTH", interval_count: 1 }, pricing_scheme: {} }] }))).toThrow();
  });
});

const clean = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false });
const usd = (amount: number) => ({ amount, currency: "USD" as const });
let deps: Deps;
let hh: string;
let run: ReturnType<typeof vi.fn<Run>>;
let warn: ReturnType<typeof vi.fn<NonNullable<Deps["warn"]>>>;

beforeEach(async () => {
  const db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  const allowance = { weekly: usd(40000), askAbove: usd(3000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
  await createSpender(db, { householdId: hh, id: "agent", name: "Shopping agent", kind: "agent", spotterName: "Sam", allowance });
  await createSpender(db, { householdId: hh, id: "other", name: "Other agent", kind: "agent", spotterName: "Sam", allowance });
  run = vi.fn<Run>(async (method, args) => {
    if (method === "show_subscription_plan_details") return JSON.stringify(plan());
    if (method === "create_subscription")
      return JSON.stringify({ id: "I-BW452GLLEP1G", status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1" }, { rel: "self", href: "x" }] });
    if (method === "show_subscription_details") return JSON.stringify({ id: args.subscription_id, status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1" }] });
    throw new Error(`unexpected ${method}`);
  });
  warn = vi.fn<NonNullable<Deps["warn"]>>(async () => {});
  deps = {
    db,
    check: vi.fn<Deps["check"]>(async () => clean()),
    warn,
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "5O190127TN364715T", authorizationId: "A1" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
});

describe("create_subscription through Spotter", () => {
  it("stays waiting at PayPal, the tail goes to the spotter, and the agent never sees the approval link", async () => {
    const raw = await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ" });
    expect(raw).not.toContain("ba_token");
    expect(raw).not.toContain("sandbox.paypal.com");
    const r = JSON.parse(raw);
    expect(r).toMatchObject({ id: "I-BW452GLLEP1G", status: "APPROVAL_PENDING" });
    expect(r.spotter.message).toMatch(/Sam/);
    expect(run).toHaveBeenCalledWith("create_subscription", { plan_id: "P-5ML4271244454362WXNWU5NQ" }, expect.anything());
    expect(String(warn.mock.calls[0]![1].text)).toContain("US$0.00 now, US$39.99 in 7 days");
    const [held] = await listHeldSubscriptions(deps.db, hh);
    expect(held).toMatchObject({ status: "held", plan_name: "Example: StreamBox Premium (sandbox)" });
    expect(held).not.toHaveProperty("approve_url");
  });

  it("create_subscription sends a PayPal-Request-Id made from the held subscription row's id", async () => {
    await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ" });
    const [row] = await deps.db.query<{ id: string }>("select id from held_subscriptions");
    expect(run).toHaveBeenCalledWith("create_subscription", expect.anything(), { requestId: `subscription-${row!.id}` });
  });

  it("show_subscription_details only for the agent's own, and never with the approval link", async () => {
    await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ" });
    const mine = await scopedShowSubscription(deps, run, "agent", "I-BW452GLLEP1G");
    expect(mine).not.toContain("ba_token");
    expect(JSON.parse(mine).status).toBe("APPROVAL_PENDING");
    expect(JSON.parse(await scopedShowSubscription(deps, run, "other", "I-BW452GLLEP1G")).error).toBeTruthy();
  });

  it("the approval link only comes out with the spotter's decision, for their household", async () => {
    await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ" });
    const [held] = await listHeldSubscriptions(deps.db, hh);
    expect((await decideSubscription(deps.db, "hh_else", held!.id, "approve", "Kim")).ok).toBe(false);
    const ok = await decideSubscription(deps.db, hh, held!.id, "approve", "Sam");
    expect(ok).toMatchObject({ ok: true, approveUrl: expect.stringContaining("ba_token=BA-1") });
    expect((await decideSubscription(deps.db, hh, held!.id, "approve", "Sam")).ok).toBe(false);
  });

  it("denying drops the link", async () => {
    await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ" });
    const [held] = await listHeldSubscriptions(deps.db, hh);
    expect((await decideSubscription(deps.db, hh, held!.id, "deny", "Sam")).ok).toBe(true);
    const [row] = await deps.db.query<{ approve_url: string | null }>("select approve_url from held_subscriptions where id = $1", [held!.id]);
    expect(row!.approve_url).toBeNull();
  });

  it("catches the same money cut up: a held order to the same payee, then a subscription to it", async () => {
    await submitPayment(deps, { spenderId: "agent", money: usd(15000), payee: { name: "GadgetBarn", isNew: true }, category: "electronics", method: "paypal_order", context: "Earbuds" });
    const r = JSON.parse(await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ", payee: "GadgetBarn" }));
    expect(r.spotter.message).toMatch(/cut up/i);
    const [held] = await listHeldSubscriptions(deps.db, hh);
    expect(held!.cut_up).toMatchObject({ payee: "GadgetBarn", held: 15000 });
    expect(String(warn.mock.calls.at(-1)![1].text)).toMatch(/US\$150\.00/);
  });

  it("no approval link from PayPal: the agent is told, nothing is held for the spotter to lose", async () => {
    run.mockImplementation(async (method) =>
      method === "show_subscription_plan_details" ? JSON.stringify(plan()) : JSON.stringify({ id: "I-NOLINK", status: "APPROVAL_PENDING", links: [] }),
    );
    expect(JSON.parse(await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ" })).error).toBeTruthy();
    expect(await listHeldSubscriptions(deps.db, hh)).toHaveLength(0);
  });

  it("the toolkit's LlmError on the plan read starts nothing", async () => {
    run.mockImplementationOnce(async () => JSON.stringify({ ok: false, status: 404, code: "PAYPAL_API_HTTP_ERROR", message: "RESOURCE_NOT_FOUND" }));
    expect(JSON.parse(await holdSubscription(deps, run, "agent", { plan_id: "P-NOPE00000000000" })).error).toBeTruthy();
    expect(run).not.toHaveBeenCalledWith("create_subscription", expect.anything());
  });

  it("a plan PayPal can't show, or a frozen agent, starts nothing", async () => {
    run.mockImplementationOnce(async () => JSON.stringify({ error: { message: "RESOURCE_NOT_FOUND", type: "paypal_error" } }));
    expect(JSON.parse(await holdSubscription(deps, run, "agent", { plan_id: "P-NOPE00000000000" })).error).toBeTruthy();
    await deps.db.query("update spenders set frozen_at = now() where id = 'agent'");
    expect(JSON.parse(await holdSubscription(deps, run, "agent", { plan_id: "P-5ML4271244454362WXNWU5NQ" })).error).toBeTruthy();
    expect(run).not.toHaveBeenCalledWith("create_subscription", expect.anything());
  });
});
