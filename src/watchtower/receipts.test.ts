import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { HH_COOKIE, householdCookie } from "@/server/auth";
import { RECEIPTS_PER_FAMILY, makeReceiptStore } from "./receipts";

const cookieFor = (hh: string) => `${HH_COOKIE}=${/=([^;]*)/.exec(householdCookie(hh))![1]}`;
const req = (method: string, hh: string | null, body?: unknown) =>
  new Request("http://x/api/watchtower/receipts", {
    method,
    headers: { ...(hh ? { cookie: cookieFor(hh) } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const receipt = (runId: string, extra: Record<string, unknown> = {}) => ({
  runId,
  threadId: "t1",
  agentId: "spotter",
  startedAt: 1_760_000_000_000,
  ms: 4200,
  status: "ok",
  turns: 3,
  tokens: { input: 900, output: 80 },
  tools: [{ name: "open_case_file", calls: 2, ms: 40, failed: 0, access: "read" }],
  helpers: [],
  unknown: [],
  moneyActions: 0,
  boardChanges: 1,
  flagged: false,
  ...extra,
});

let db: Db;
let a: string;
let b: string;
beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  a = (await createHousehold(db, { name: "A", spotterName: "A" })).id;
  b = (await createHousehold(db, { name: "B", spotterName: "B" })).id;
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
});

describe("AI receipts", () => {
  it("needs a signed in family", async () => {
    const s = makeReceiptStore(db);
    expect((await s.post(req("POST", null, receipt("r1")))).status).toBe(401);
    expect((await s.list(req("GET", null))).status).toBe(401);
  });

  it("keeps a receipt for that family only, newest first", async () => {
    const s = makeReceiptStore(db);
    expect((await s.post(req("POST", a, receipt("r1")))).status).toBe(200);
    expect((await s.post(req("POST", a, receipt("r2", { boardChanges: 0 })))).status).toBe(200);
    const mine = (await (await s.list(req("GET", a))).json()) as { receipts: Array<{ runId: string }> };
    expect(mine.receipts.map((r) => r.runId)).toEqual(["r2", "r1"]);
    const theirs = (await (await s.list(req("GET", b))).json()) as { receipts: unknown[] };
    expect(theirs.receipts).toEqual([]);
  });

  it("refuses anything that isn't a compact receipt", async () => {
    const s = makeReceiptStore(db);
    expect((await s.post(req("POST", a, { ...receipt("r1"), question: "what did Gran pay?" }))).status).toBe(400);
    expect((await s.post(req("POST", a, "not json"))).status).toBe(400);
    expect((await s.post(req("POST", a, { ...receipt("r1"), tools: [{ name: "x", calls: 1, ms: 1, failed: 0, access: "read" }] }))).status).toBe(400);
    expect((await s.post(req("POST", a, "x".repeat(20_000)))).status).toBe(413);
  });

  it("saving the same run twice keeps one", async () => {
    const s = makeReceiptStore(db);
    await s.post(req("POST", a, receipt("r1")));
    await s.post(req("POST", a, receipt("r1")));
    const [row] = await db.query<{ n: string }>("select count(*)::text as n from watchtower_receipts where household_id = $1", [a]);
    expect(row!.n).toBe("1");
  });

  it("keeps the newest receipts only", async () => {
    const s = makeReceiptStore(db, { keep: 3 });
    for (let i = 0; i < 5; i++) await s.post(req("POST", a, receipt(`r${i}`)));
    const [row] = await db.query<{ n: string }>("select count(*)::text as n from watchtower_receipts where household_id = $1", [a]);
    expect(row!.n).toBe("3");
    expect(RECEIPTS_PER_FAMILY).toBe(50);
  });

  it("stores a flagged run as flagged", async () => {
    const s = makeReceiptStore(db);
    await s.post(req("POST", a, receipt("r9", { unknown: ["send_money"], moneyActions: 1, flagged: true, tools: [{ name: "send_money", calls: 1, ms: 5, failed: 0, access: "unknown" }] })));
    const [row] = await db.query<{ flagged: boolean }>("select flagged from watchtower_receipts where run_id = 'r9'");
    expect(row!.flagged).toBe(true);
  });
});
