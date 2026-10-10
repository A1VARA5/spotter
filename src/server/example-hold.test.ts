import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createDemoHousehold, listSpenders } from "@/core/households";
import { approve, deny, listPayments, type Deps } from "@/core/lifecycle";
import { createExampleHold, EXAMPLE_LABEL } from "./example-hold";

let db: Db;
let hh: string;
const paypal = () => ({
  createAuthorizeOrder: vi.fn(async (_req: unknown, _opts: unknown) => ({ orderId: "ORDER1", authorizationId: "AUTH1", expiresAt: "2026-11-08T00:00:00Z" })),
  captureAuthorization: vi.fn(async () => ({ captureId: "CAP1", status: "COMPLETED" })),
  voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
});

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createDemoHousehold(db)).id;
});

describe("the demo family's example hold", () => {
  it("is one real PayPal sandbox hold for Gran, waiting for the spotter, with a case file labelled as an example", async () => {
    const pp = paypal();
    expect(await createExampleHold({ db, paypal: pp }, hh)).toBe("created");
    expect(pp.createAuthorizeOrder).toHaveBeenCalledTimes(1);
    expect(pp.createAuthorizeOrder.mock.calls[0]![1]).toEqual({ source: "card" });
    const [p, ...rest] = await listPayments(db, hh);
    expect(rest).toHaveLength(0);
    const gran = (await listSpenders(db, hh)).find((s) => s.kind === "person")!;
    expect(p).toMatchObject({ spender_id: gran.id, status: "needs_approval", paypal_order_id: "ORDER1", paypal_authorization_id: "AUTH1" });
    expect(p!.decision!.outcome).toBe("ask");
    // Never pretends it was just checked live.
    expect(p!.case_file).toMatchObject({ example: true, verdict: "likely_scam", status: "done" });
    expect(p!.case_file!.headline).toContain(EXAMPLE_LABEL);
    expect(p!.ai!.summary).toContain(EXAMPLE_LABEL);
    expect(EXAMPLE_LABEL).toBe("Example, checked earlier");
    // Every warning sign quotes the message for real.
    for (const f of p!.ai!.flags) expect(p!.request.context.toLowerCase()).toContain(f.quote.toLowerCase());
    // Every finding names a call in its own call list.
    for (const f of p!.case_file!.findings) expect(p!.case_file!.calls.map((c) => c.id)).toContain(f.source);
  });

  it("can be approved (real capture) or denied (real void) like any hold", async () => {
    const pp = paypal();
    await createExampleHold({ db, paypal: pp }, hh);
    const [p] = await listPayments(db, hh);
    const deps = { db, check: vi.fn(), paypal: pp } as unknown as Deps;
    const denied = await deny(deps, p!.id, "Sam");
    expect(denied.status).toBe("voided");
    expect(pp.voidAuthorization).toHaveBeenCalledWith("AUTH1");

    await createExampleHold({ db, paypal: pp }, hh);
    const [q] = (await listPayments(db, hh)).filter((x) => x.status === "needs_approval");
    expect((await approve(deps, q!.id, "Sam")).status).toBe("captured");
  });

  it("when PayPal is down or slow, the family starts without it and says so", async () => {
    const down = { ...paypal(), createAuthorizeOrder: vi.fn(async () => Promise.reject(new Error("503"))) };
    expect(await createExampleHold({ db, paypal: down }, hh)).toBe("paypal_unavailable");
    const slow = { ...paypal(), createAuthorizeOrder: vi.fn(() => new Promise<never>(() => {})) };
    const started = Date.now();
    expect(await createExampleHold({ db, paypal: slow }, hh, 50)).toBe("paypal_unavailable");
    expect(Date.now() - started).toBeLessThan(1000);
    const declined = { ...paypal(), createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: undefined })) };
    expect(await createExampleHold({ db, paypal: declined as never }, hh)).toBe("paypal_unavailable");
    expect(await listPayments(db, hh)).toHaveLength(0);
  });
});
