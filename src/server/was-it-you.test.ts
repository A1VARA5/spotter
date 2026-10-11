import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createDemoHousehold, createHousehold } from "@/core/households";
import { getPayment, type Deps } from "@/core/lifecycle";
import { answerRequest, startExampleAsk } from "./was-it-you";

let db: Db;
let deps: Deps;
let demo: string;
const voidAuth = vi.fn(async () => ({ status: "VOIDED" }));
const capture = vi.fn(async () => ({ captureId: "C", status: "COMPLETED" }));

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  voidAuth.mockClear();
  capture.mockClear();
  deps = {
    db,
    check: vi.fn(),
    paypal: { createAuthorizeOrder: vi.fn(async () => ({ orderId: "O9", authorizationId: "A9", expiresAt: "2026-11-08T00:00:00Z" })), captureAuthorization: capture, voidAuthorization: voidAuth },
  } as unknown as Deps;
  demo = (await createDemoHousehold(db)).id;
});

const post = (body: unknown) => new Request("http://x/api/was-it-you", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("the side by side demo", () => {
  it("makes a real sandbox hold for Gran with an example ask to Tom, every part labelled", async () => {
    const r = await startExampleAsk(deps, demo);
    if (typeof r === "string") throw new Error(r);
    expect(r.payment).toMatchObject({ status: "needs_approval", paypal_authorization_id: "A9" });
    expect(r.payment.was_it_you).toMatchObject({ who: "Tom", channel: "example", state: "asked", target: { kind: "example" }, claim: { name: "Tom", quote: "it's Tom" } });
    expect(r.payment.request.context).toContain(r.payment.was_it_you!.claim.quote);
    expect(r.payment.case_file).toMatchObject({ example: true });
    expect(r.token).toMatch(/^wiy_/);
  });

  it("only demo families get it", async () => {
    const real = (await createHousehold(db, { name: "Real", spotterName: "Ann" })).id;
    expect(await startExampleAsk(deps, real)).toBe("not_demo");
  });

  it("Not me on Tom's example phone really voids the sandbox hold, once", async () => {
    const r = await startExampleAsk(deps, demo);
    if (typeof r === "string") throw new Error(r);
    const res = await answerRequest(deps, post({ token: r.token, answer: "not_me" }), demo);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.payment.status).toBe("voided");
    expect(j.payment.was_it_you.state).toBe("not_me");
    expect(voidAuth).toHaveBeenCalledWith("A9");
    expect((await answerRequest(deps, post({ token: r.token, answer: "not_me" }), demo)).status).toBe(409);
    expect(voidAuth).toHaveBeenCalledTimes(1);
  });

  it("another family's session, or no session, can't answer the example", async () => {
    const r = await startExampleAsk(deps, demo);
    if (typeof r === "string") throw new Error(r);
    const other = (await createDemoHousehold(db)).id;
    expect((await answerRequest(deps, post({ token: r.token, answer: "not_me" }), other)).status).toBe(403);
    expect((await answerRequest(deps, post({ token: r.token, answer: "not_me" }), null)).status).toBe(403);
    expect((await getPayment(db, r.payment.id))!.status).toBe("needs_approval");
  });

  it("Yes, it's me never captures", async () => {
    const r = await startExampleAsk(deps, demo);
    if (typeof r === "string") throw new Error(r);
    const j = await (await answerRequest(deps, post({ token: r.token, answer: "it_was_me" }), demo)).json();
    expect(j.payment.status).toBe("needs_approval");
    expect(j.reply).toMatch(/PIN/);
    expect(capture).not.toHaveBeenCalled();
  });

  it("rejects junk", async () => {
    expect((await answerRequest(deps, post({ token: "nope", answer: "not_me" }), demo)).status).toBe(403);
    expect((await answerRequest(deps, post({ token: "x", answer: "approve" }), demo)).status).toBe(400);
    expect((await answerRequest(deps, new Request("http://x", { method: "POST", body: "{" }), demo)).status).toBe(400);
  });

  it("caps how many example holds one family can make in a day", async () => {
    for (let i = 0; i < 12; i++) await startExampleAsk(deps, demo);
    expect(await startExampleAsk(deps, demo)).toBe("limit");
  });
});
