import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "./households";
import { fileReport, networkCount, reportKey } from "./network";

let db: Db;
let a: string, b: string, c: string;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

beforeEach(async () => {
  db = await pgliteDb();
  a = (await createHousehold(db, { name: "A", spotterName: "A" })).id;
  b = (await createHousehold(db, { name: "B", spotterName: "B" })).id;
  c = (await createHousehold(db, { name: "C", spotterName: "C" })).id;
});

describe("reportKey", () => {
  it("is the same for the same payee written differently", () => {
    expect(reportKey(" Jamie.K1994@Gmail.com ")).toBe(reportKey("jamie.k1994@gmail.com"));
    expect(reportKey("jamie.k1994@gmail.com​")).toBe(reportKey("jamie.k1994@gmail.com"));
  });

  it("never contains the identifier itself", () => {
    expect(reportKey("jamie.k1994@gmail.com")).not.toContain("jamie");
    expect(reportKey("jamie.k1994@gmail.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("network", () => {
  it("counts other families that said no, not your own", async () => {
    await fileReport(db, { householdId: a, identifier: "jamie.k1994@gmail.com", kind: "denied" });
    await fileReport(db, { householdId: b, identifier: "Jamie.K1994@gmail.com", kind: "blocked" });
    expect((await networkCount(db, "jamie.k1994@gmail.com", c)).families).toBe(2);
    expect((await networkCount(db, "jamie.k1994@gmail.com", a)).families).toBe(1);
  });

  it("counts a family once however often it reports", async () => {
    await fileReport(db, { householdId: a, identifier: "x@y.com", kind: "denied" });
    await fileReport(db, { householdId: a, identifier: "x@y.com", kind: "blocked" });
    expect((await networkCount(db, "x@y.com", c)).families).toBe(1);
  });

  it("stores no raw identifier", async () => {
    await fileReport(db, { householdId: a, identifier: "jamie.k1994@gmail.com", kind: "denied" });
    const rows = await db.query<Record<string, unknown>>("select * from reports");
    expect(JSON.stringify(rows)).not.toContain("jamie");
  });

  it("forgets reports older than the window", async () => {
    await fileReport(db, { householdId: a, identifier: "x@y.com", kind: "denied" });
    await db.query("update reports set at = now() - interval '31 days'");
    expect((await networkCount(db, "x@y.com", c)).families).toBe(0);
  });

  it("ignores empty identifiers", async () => {
    await fileReport(db, { householdId: a, identifier: "   ", kind: "denied" });
    expect(await db.query("select * from reports")).toHaveLength(0);
  });
});
