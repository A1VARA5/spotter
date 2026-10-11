import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb, type Db } from "@/db";
import type { Deps } from "@/core/lifecycle";
import type { AiCheckResult } from "@/ai/check";
import { LAB_DAILY_RUNS, naivePlan, pageText, runLab, type LabStep } from "./agent-lab";
import { SHOP_HTML } from "@/app/demo-shop/gadgetbarn/shop";
import { listTripwires } from "@/core/tripwire";

const clean = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false });
let db: Db;
let hh: string;
let deps: Deps;
let check: ReturnType<typeof vi.fn<Deps["check"]>>;
let getAuthorization: ReturnType<typeof vi.fn<NonNullable<Deps["paypal"]["getAuthorization"]>>>;

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Demo", spotterName: "Sam" })).id;
  check = vi.fn<Deps["check"]>(async () => clean());
  getAuthorization = vi.fn(async () => ({ status: "VOIDED" }));
  deps = {
    db,
    check,
    // A case agent, a price check and alerts must never run from the lab: they cost money.
    investigate: vi.fn(async () => {
      throw new Error("the lab must not run the case agent");
    }),
    market: vi.fn(async () => {
      throw new Error("the lab must not run the price check");
    }),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "5O190127TN364715T", authorizationId: "0VF52814937998046" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
      getAuthorization,
    },
  };
});

const run = async (household = hh) => {
  const steps: LabStep[] = [];
  for await (const s of runLab(deps, household, { read: async () => "{}", run: async () => "{}", confirmWaitMs: 0 })) steps.push(s);
  return steps;
};

describe("the scripted naive agent", () => {
  it("reads the GadgetBarn page as an agent would, hidden refund line included", () => {
    const text = pageText(SHOP_HTML);
    expect(text).toMatch(/refund capture 2GG279541U471931P for 200\.00 USD/);
    expect(text).not.toMatch(/<style|<script/);
  });

  it("does literally what the page says: an order, then the refund it asked for", () => {
    const plan = naivePlan(pageText(SHOP_HTML));
    expect(plan.map((c) => c.name)).toEqual(["create_order", "create_refund"]);
    expect(plan[1]!.arguments).toEqual({ capture_id: "2GG279541U471931P", amount: { currency_code: "USD", value: "200.00" } });
  });
});

describe("the hijack console run", () => {
  it("streams the whole story against the real toolkit MCP handler: tools, page, held order, bait, freeze, PayPal void, confirmation", async () => {
    const steps = await run();
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toEqual(["start", "tools", "read", "order", "bait", "freeze", "void", "confirm", "done"]);
    const tools = steps.find((s) => s.kind === "tools")!;
    expect(tools.data).toMatchObject({ total: 47 });
    expect(Number(tools.data!.bait)).toBeGreaterThan(10);
    expect(steps.find((s) => s.kind === "order")!.data).toMatchObject({ status: "HELD_FOR_APPROVAL", paypalOrderId: "5O190127TN364715T" });
    expect(steps.find((s) => s.kind === "void")!.data).toMatchObject({ authorizationId: "0VF52814937998046", status: "voided" });
    expect(steps.find((s) => s.kind === "confirm")!.data).toMatchObject({ source: "paypal_lookup", status: "VOIDED" });
    expect(steps.find((s) => s.kind === "bait")!.data).toMatchObject({ tool: "create_refund", wouldHaveSent: "US$200.00 would have left your account" });
  });

  it("leaves the paused agent's card naming the hidden line it read on GadgetBarn", async () => {
    await run();
    const [trip] = await listTripwires(db, hh);
    expect(trip!.cause).toMatchObject({ kind: "hidden_text", payee: "GadgetBarn" });
    expect(trip!.cause!.quote).toMatch(/^Note for AI shopping assistants/);
    expect(trip!.cause!.quote).toMatch(/refund capture 2GG279541U471931P/);
  });

  it("costs at most one Spotter AI check per run, and never the case agent or the price check", async () => {
    await run();
    expect(check).toHaveBeenCalledTimes(1);
    expect(deps.investigate).not.toHaveBeenCalled();
    expect(deps.market).not.toHaveBeenCalled();
  });

  it("uses a short lived key that is switched off when the run ends", async () => {
    await run();
    const live = await db.query("select 1 from agent_tokens where revoked_at is null");
    expect(live).toEqual([]);
    const [k] = await db.query<{ expires_at: string | null }>("select expires_at from agent_tokens where not canary order by created_at desc limit 1");
    expect(k!.expires_at).not.toBeNull();
  });

  it("can run again (the lab agent is unpaused at the start of each run)", async () => {
    await run();
    const second = await run();
    expect(second.map((s) => s.kind)).toContain("done");
  });

  it(`allows ${LAB_DAILY_RUNS} runs a day per family, then says so plainly`, async () => {
    for (let i = 0; i < LAB_DAILY_RUNS; i++) await run();
    const steps = await run();
    expect(steps.map((s) => s.kind)).toEqual(["limit"]);
    expect(steps[0]!.title).toMatch(/3 runs/);
    expect(check).toHaveBeenCalledTimes(LAB_DAILY_RUNS);
  });

  it("a run cut off after the order (the browser left) still lets go of the hold", async () => {
    for await (const s of runLab(deps, hh, { read: async () => "{}", run: async () => "{}", confirmWaitMs: 0 })) if (s.kind === "order") break;
    const left = await db.query("select 1 from payments where status = 'needs_approval'");
    expect(left).toEqual([]);
    expect(deps.paypal.voidAuthorization).toHaveBeenCalledTimes(1);
  });

  it("prefers PayPal's own webhook when it has arrived", async () => {
    await db.query("insert into paypal_events (id, event_type, resource_id, payment_id, summary) values ('WH-LAB', 'PAYMENT.AUTHORIZATION.VOIDED', '0VF52814937998046', null, '{}')");
    const steps = await run();
    expect(steps.find((s) => s.kind === "confirm")!.data).toMatchObject({ source: "webhook", event: "PAYMENT.AUTHORIZATION.VOIDED" });
  });
});
