import { beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender } from "@/core/lifecycle";
import { setPin } from "./auth";
import { checkApproval } from "./approval";

let db: Db;
let hh: string;
const allowance = { weekly: { amount: 40000, currency: "GBP" as const }, askAbove: { amount: 3000, currency: "GBP" as const }, blockedCategories: [], allowedPayees: [], blockedPayees: [] };

async function held(id: string, opts: { caseFile?: boolean; secondsAgo?: number } = {}) {
  await db.query(
    `insert into payments (id, spender_id, request, status, amount, currency, case_file, created_at)
     values ($1, 'sp_a', '{}'::jsonb, 'needs_approval', 2500, 'GBP', $2, now() - make_interval(secs => $3))`,
    [id, opts.caseFile ? JSON.stringify({ verdict: "unclear" }) : null, opts.secondsAgo ?? 300],
  );
}

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Fam", spotterName: "Sam" })).id;
  await createSpender(db, { id: "sp_a", householdId: hh, name: "Agent", kind: "agent", spotterName: "Sam", allowance });
  await setPin(db, hh, "2468");
});

describe("approving needs the PIN every time", () => {
  it("asks for the PIN when there isn't one", async () => {
    await held("pay_1", { caseFile: true });
    const res = await checkApproval(db, hh, "pay_1", undefined);
    expect(res?.status).toBe(400);
  });

  it("refuses a wrong PIN", async () => {
    await held("pay_1", { caseFile: true });
    expect((await checkApproval(db, hh, "pay_1", "1111"))?.status).toBe(403);
  });

  it("lets the right PIN through once the checks are done", async () => {
    await held("pay_1", { caseFile: true });
    expect(await checkApproval(db, hh, "pay_1", "2468")).toBeNull();
  });

  it("waits while Spotter is still looking into a fresh hold", async () => {
    await held("pay_1", { secondsAgo: 5 });
    const res = await checkApproval(db, hh, "pay_1", "2468");
    expect(res?.status).toBe(409);
    expect((await res!.json()).error).toMatch(/still looking/);
  });

  it("doesn't wait forever when the case never came", async () => {
    await held("pay_1", { secondsAgo: 120 });
    expect(await checkApproval(db, hh, "pay_1", "2468")).toBeNull();
  });

  it("locks after too many wrong PINs", async () => {
    await held("pay_1", { caseFile: true });
    let last: Response | null = null;
    for (let i = 0; i < 8; i++) last = await checkApproval(db, hh, "pay_1", "0000");
    expect(last?.status).toBe(429);
  });
});
