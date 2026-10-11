import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb } from "@/db";
import { createSpender, type Deps } from "@/core/lifecycle";
import type { AiCheckResult } from "@/ai/check";
import { recordSale, requestRefund, type Run } from "@/core/selling";
import { springTripwire } from "@/core/tripwire";
import { householdCookie, setPin, unlockCookie } from "./auth";
import { makeAgentHolds, type CreateSale } from "./agent-holds";

const clean = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false });
const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
let deps: Deps;
let hh: string;
let other: string;
let run: ReturnType<typeof vi.fn<Run>>;
let sale: ReturnType<typeof vi.fn<CreateSale>>;
let h: ReturnType<typeof makeAgentHolds>;

const paid = JSON.stringify({ id: "1AB23456CD789012E", purchase_units: [{ payments: { captures: [{ id: "2GG279541U471931P", status: "COMPLETED", amount: { currency_code: "GBP", value: "50.00" } }] } }] });

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  const db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  other = (await createHousehold(db, { name: "Other", spotterName: "Kim" })).id;
  await setPin(db, hh, "2468");
  await setPin(db, other, "1357");
  const allowance = { weekly: gbp(40000), askAbove: gbp(3000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
  await createSpender(db, { householdId: hh, id: "agent", name: "Leo's agent", kind: "agent", spotterName: "Sam", allowance });
  await createSpender(db, { householdId: hh, id: "gran", name: "Gran", kind: "person", spotterName: "Sam", allowance });
  run = vi.fn<Run>(async (method) => (method === "get_order" ? paid : JSON.stringify({ id: "3RF12345AB678901C", status: "COMPLETED" })));
  sale = vi.fn<CreateSale>(async () => ({ orderId: "1AB23456CD789012E", captureId: "2GG279541U471931P" }));
  deps = {
    db,
    check: vi.fn<Deps["check"]>(async () => clean()),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "X", authorizationId: "A1" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  h = makeAgentHolds({ deps: async () => deps, run, createSale: sale });
});

const val = (c: string) => c.split(";")[0]!;
const req = (household: string, body?: unknown) =>
  new Request("http://x/api/toolkit/holds", {
    method: body ? "POST" : "GET",
    headers: { cookie: `${val(householdCookie(household))}; ${val(unlockCookie(household))}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe("the spotter's agent holds", () => {
  it("unfreezing a paused agent needs the right PIN, and only works on their own agent", async () => {
    await springTripwire(deps, "agent", "create_refund", {});
    expect((await h.POST(req(hh, { kind: "agent", id: "agent", action: "unfreeze" }))).status).toBe(400);
    expect((await h.POST(req(hh, { kind: "agent", id: "agent", action: "unfreeze", pin: "0000" }))).status).toBe(403);
    expect((await h.POST(req(other, { kind: "agent", id: "agent", action: "unfreeze", pin: "1357" }))).status).toBe(404);
    expect((await h.POST(req(hh, { kind: "agent", id: "agent", action: "unfreeze", pin: "2468" }))).status).toBe(200);
    const [s] = await deps.db.query<{ frozen_at: string | null }>("select frozen_at from spenders where id = 'agent'");
    expect(s!.frozen_at).toBeNull();
  });

  it("approving a refund needs the PIN and runs it; the list shows it to this family only", async () => {
    await deps.db.query("update spenders set agent_job = 'selling' where id = 'agent'");
    await recordSale(deps.db, { householdId: hh, spenderId: "agent", orderId: "1AB23456CD789012E", captureId: "2GG279541U471931P", amount: 5000, currency: "GBP", item: "Trainers", example: true });
    await requestRefund(deps, run, "agent", { capture_id: "2GG279541U471931P", amount: { currency_code: "GBP", value: "20.00" } });
    const list = await (await h.GET(req(hh))).json();
    expect(list.refunds).toHaveLength(1);
    expect((await (await h.GET(req(other))).json()).refunds).toHaveLength(0);
    const id = list.refunds[0].id;
    expect((await h.POST(req(hh, { kind: "refund", id, action: "approve" }))).status).toBe(400);
    expect(run).not.toHaveBeenCalledWith("create_refund", expect.anything());
    const ok = await h.POST(req(hh, { kind: "refund", id, action: "approve", pin: "2468" }));
    expect(ok.status).toBe(200);
    expect(run).toHaveBeenCalledWith("create_refund", expect.objectContaining({ capture_id: "2GG279541U471931P" }));
  });

  it("sets an agent's job, only for agents in this family", async () => {
    expect((await h.POST(req(hh, { kind: "agent", id: "agent", action: "job", job: "selling" }))).status).toBe(200);
    expect((await h.POST(req(hh, { kind: "agent", id: "gran", action: "job", job: "selling" }))).status).toBe(400);
    expect((await h.POST(req(other, { kind: "agent", id: "agent", action: "job", job: "shopping" }))).status).toBe(404);
    const [s] = await deps.db.query<{ agent_job: string }>("select agent_job from spenders where id = 'agent'");
    expect(s!.agent_job).toBe("selling");
  });

  it("an example sale is made for a selling agent, labelled as an example", async () => {
    expect((await h.POST(req(hh, { kind: "sale", id: "agent", action: "example" }))).status).toBe(400);
    await deps.db.query("update spenders set agent_job = 'selling' where id = 'agent'");
    const r = await h.POST(req(hh, { kind: "sale", id: "agent", action: "example" }));
    expect(r.status).toBe(200);
    const [row] = await deps.db.query<{ example: boolean; capture_id: string; household_id: string }>("select example, capture_id, household_id from sales");
    expect(row).toMatchObject({ example: true, capture_id: "2GG279541U471931P", household_id: hh });
  });

  it("refuses without a session", async () => {
    const r = await h.POST(new Request("http://x/api/toolkit/holds", { method: "POST", body: "{}" }));
    expect(r.status).toBe(401);
  });
});
