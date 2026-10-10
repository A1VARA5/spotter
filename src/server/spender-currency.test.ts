import { beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, getSpender } from "@/core/lifecycle";
import { HH_COOKIE, UNLOCK_COOKIE, householdCookie, unlockCookie } from "./auth";
import { setAgentCurrency } from "./spender-currency";

const val = (c: string) => /=([^;]*)/.exec(c)![1]!;
let db: Db;
let hh: string;
const req = (body: unknown, household = () => hh, unlocked = true) => {
  const cookies = [`${HH_COOKIE}=${val(householdCookie(household()))}`];
  if (unlocked) cookies.push(`${UNLOCK_COOKIE}=${val(unlockCookie(household()))}`);
  return new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body), headers: { cookie: cookies.join("; "), "content-type": "application/json" } });
};
const allowance = { weekly: { amount: 40000, currency: "GBP" as const }, askAbove: { amount: 3000, currency: "GBP" as const }, blockedCategories: [], allowedPayees: [], blockedPayees: [] };

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Fam", spotterName: "Sam" })).id;
  await createSpender(db, { id: "sp_agent", householdId: hh, name: "Agent", kind: "agent", spotterName: "Sam", allowance });
  await createSpender(db, { id: "sp_gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance });
});

describe("agent allowance currency", () => {
  it("switches an agent's allowance to dollars, keeping the numbers", async () => {
    const res = await setAgentCurrency(db, req({ currency: "USD" }), "sp_agent");
    expect(res.status).toBe(200);
    const s = await getSpender(db, "sp_agent");
    expect(s!.allowance.weekly).toEqual({ amount: 40000, currency: "USD" });
    expect(s!.allowance.askAbove).toEqual({ amount: 3000, currency: "USD" });
  });

  it("only works for AI agents", async () => {
    expect((await setAgentCurrency(db, req({ currency: "USD" }), "sp_gran")).status).toBe(400);
  });

  it("needs the PIN and the right family", async () => {
    expect((await setAgentCurrency(db, req({ currency: "USD" }, () => hh, false), "sp_agent")).status).toBe(401);
    const other = (await createHousehold(db, { name: "B", spotterName: "B" })).id;
    expect((await setAgentCurrency(db, req({ currency: "USD" }, () => other), "sp_agent")).status).toBe(404);
  });

  it("accepts only pounds or dollars", async () => {
    expect((await setAgentCurrency(db, req({ currency: "EUR" }), "sp_agent")).status).toBe(400);
  });
});
