import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb } from "@/db";
import { createSpender, type Deps } from "@/core/lifecycle";
import { makeHandlers } from "./payments";

let h: ReturnType<typeof makeHandlers>;
let capture: ReturnType<typeof vi.fn>;
let otherHh: string;

let hhId: string;

beforeEach(async () => {
  const db = await pgliteDb();
  hhId = (await createHousehold(db, { name: "Test", spotterName: "Aivaras" })).id;
  await createSpender(db, {
    householdId: hhId,
    id: "agent1",
    name: "Shopping agent",
    kind: "agent",
    spotterName: "Aivaras",
    allowance: { weekly: { amount: 10000, currency: "GBP" }, askAbove: { amount: 2000, currency: "GBP" }, blockedCategories: [], allowedPayees: [], blockedPayees: [] },
  });
  const deps: Deps = {
    db,
    check: vi.fn(async () => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O1", authorizationId: "A1" })),
      captureAuthorization: (capture = vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" }))),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  otherHh = (await createHousehold(db, { name: "Other", spotterName: "Other" })).id;
  h = makeHandlers(async () => deps);
});

const post = (body: unknown) =>
  new Request("http://x/api/payments", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const valid = {
  spenderId: "agent1",
  amount: 2500,
  currency: "GBP",
  payee: "Clay & Kiln",
  payeeIsNew: false,
  category: "gifts",
  method: "paypal_order",
  context: "Handmade mug",
};

describe("payments API", () => {
  it("creates a payment and returns the decision", async () => {
    const r = await h.submit(hhId, post(valid));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.payment.status).toBe("needs_approval");
    expect(j.payment.decision.outcome).toBe("ask");
  });

  it("rejects a bad body with 400 and says why", async () => {
    const r = await h.submit(hhId, post({ ...valid, amount: -3 }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/amount/i);
  });

  it("rejects malformed JSON with 400", async () => {
    const r = await h.submit(hhId, new Request("http://x", { method: "POST", body: "{nope" }));
    expect(r.status).toBe(400);
  });

  it("404s an unknown spender", async () => {
    expect((await h.submit(hhId, post({ ...valid, spenderId: "ghost" }))).status).toBe(404);
  });

  it("approves a pending payment, then 409s a second approve", async () => {
    const id = (await (await h.submit(hhId, post(valid))).json()).payment.id;
    const ok = await h.approve(hhId, id, "Aivaras");
    expect(ok.status).toBe(200);
    expect((await ok.json()).payment.status).toBe("captured");
    expect((await h.approve(hhId, id, "Aivaras")).status).toBe(409);
  });

  it("denies a pending payment", async () => {
    const id = (await (await h.submit(hhId, post(valid))).json()).payment.id;
    expect((await (await h.deny(hhId, id, "Aivaras")).json()).payment.status).toBe("voided");
  });

  it("404s approve on an unknown payment", async () => {
    expect((await h.approve(hhId, "pay_nope", "Aivaras")).status).toBe(404);
  });

  it("answers a crash with JSON 500, not an HTML page", async () => {
    const broken = makeHandlers(async () => {
      throw new Error("database down");
    });
    const r = await broken.list("hh_x");
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/Nothing was paid/);
  });

  it("lists payments newest first", async () => {
    await h.submit(hhId, post(valid));
    await h.submit(hhId, post({ ...valid, amount: 500 }));
    const j = await (await h.list(hhId)).json();
    expect(j.payments).toHaveLength(2);
    expect(Number(j.payments[0].amount)).toBe(500);
  });

  it("one household can't pay as, see, approve or deny another household's people", async () => {
    expect((await h.submit(otherHh, post(valid))).status).toBe(404);
    const id = (await (await h.submit(hhId, post(valid))).json()).payment.id;
    expect((await (await h.list(otherHh)).json()).payments).toHaveLength(0);
    expect((await h.approve(otherHh, id, "Other")).status).toBe(404);
    expect((await h.deny(otherHh, id, "Other")).status).toBe(404);
    expect(capture).not.toHaveBeenCalled();
  });

  it("swap: 404 for another household, 409 when there's nothing safer to buy", async () => {
    const id = (await (await h.submit(hhId, post(valid))).json()).payment.id;
    expect((await h.swap(otherHh, id, "Other")).status).toBe(404);
    const r = await h.swap(hhId, id, "Aivaras");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/no safer option/i);
  });

  it("sleep: asks again tomorrow for the owner, keeps the hold, and says when", async () => {
    const id = (await (await h.submit(hhId, post(valid))).json()).payment.id;
    expect((await h.sleep(otherHh, id, "Other")).status).toBe(404);
    const r = await h.sleep(hhId, id, "Aivaras");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.payment.status).toBe("needs_approval");
    expect(j.payment.ask_again_at).toBeTruthy();
    expect(j.message).toMatch(/^Spotter asks again \w+day \d+ \w+ at 9am\. The money stays held\.$/);
    expect(capture).not.toHaveBeenCalled();
  });
});
