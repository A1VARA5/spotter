import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createDemoHousehold, createHousehold } from "@/core/households";
import { getPayment, type Deps } from "@/core/lifecycle";
import { answerOnDashboard, answerRequest, openExampleAsk, startExampleAsk } from "./was-it-you";

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
  it("makes a real sandbox hold for Gran with an ask to Tom, the visitor's own run (not labelled an example, round 8)", async () => {
    const r = await startExampleAsk(deps, demo);
    if (typeof r === "string") throw new Error(r);
    expect(r.payment).toMatchObject({ status: "needs_approval", paypal_authorization_id: "A9" });
    expect(r.payment.was_it_you).toMatchObject({ who: "Tom", channel: "example", state: "asked", target: { kind: "example" }, claim: { name: "Tom", quote: "it's Tom" } });
    expect(r.payment.request.context).toContain(r.payment.was_it_you!.claim.quote);
    expect(r.payment.case_file!.example).not.toBe(true);
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
    expect(voidAuth).toHaveBeenCalledWith("A9", expect.stringMatching(/^void-pay_.*-A9$/));
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

describe("answering on the dashboard", () => {
  const started = async () => {
    const r = await startExampleAsk(deps, demo);
    if (typeof r === "string") throw new Error(r);
    return r;
  };
  /** The live Hi Mum case: the message says it's from the spotter's own role, so the question is theirs. */
  const asSpotterAsk = async (id: string) =>
    db.query(`update payments set was_it_you = was_it_you || '{"channel":"alert","target":{"kind":"spotter","name":"Sam"},"who":"Sam"}'::jsonb where id = $1`, [id]);

  it("the spotter answers their own question in the app: Not me releases the hold", async () => {
    const r = await started();
    await asSpotterAsk(r.payment.id);
    const res = await answerOnDashboard(deps, demo, r.payment.id, "not_me");
    expect(res.status).toBe(200);
    expect((await res.json()).payment).toMatchObject({ status: "voided", was_it_you: { state: "not_me" } });
    expect(voidAuth).toHaveBeenCalledWith("A9", expect.stringMatching(/^void-pay_.*-A9$/));
  });

  it("an example left behind on Try can still be answered from the dashboard, as Tom", async () => {
    const r = await started();
    const res = await answerOnDashboard(deps, demo, r.payment.id, "it_was_me");
    expect(res.status).toBe(200);
    expect((await getPayment(db, r.payment.id))!).toMatchObject({ status: "needs_approval", was_it_you: { state: "it_was_me" } });
    expect(capture).not.toHaveBeenCalled();
  });

  it("never answers for a real person, and never for another family", async () => {
    const r = await started();
    const other = (await createDemoHousehold(db)).id;
    expect((await answerOnDashboard(deps, other, r.payment.id, "not_me")).status).toBe(404);
    await db.query(`update payments set was_it_you = was_it_you || '{"channel":"telegram","target":{"kind":"spender","spenderId":"x","name":"Tom"}}'::jsonb where id = $1`, [r.payment.id]);
    expect((await answerOnDashboard(deps, demo, r.payment.id, "not_me")).status).toBe(409);
    expect((await getPayment(db, r.payment.id))!.status).toBe("needs_approval");
    expect(voidAuth).not.toHaveBeenCalled();
  });

  it("finds an open example so Try can pick up where it was left", async () => {
    expect(await openExampleAsk(db, demo)).toBeNull();
    const r = await started();
    const open = await openExampleAsk(db, demo);
    expect(open?.payment.id).toBe(r.payment.id);
    expect(open?.token).toBe(r.token);
    await answerOnDashboard(deps, demo, r.payment.id, "not_me");
    expect(await openExampleAsk(db, demo)).toBeNull();
  });
});
