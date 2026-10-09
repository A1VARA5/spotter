import { beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { startDemo } from "./demo";
import { checkPin } from "./auth";
import { listSpenders } from "@/core/households";

let db: Db;
beforeEach(async () => {
  db = await pgliteDb();
});

describe("try the demo family", () => {
  it("gives each visitor their own family, unlockable with 2468", async () => {
    const a = await startDemo(db, 200);
    const b = await startDemo(db, 200);
    if (a === "limit" || b === "limit") throw new Error("hit limit");
    expect(a.householdId).not.toBe(b.householdId);
    expect(await checkPin(db, a.householdId, "2468")).toBe("ok");
    expect(await listSpenders(db, b.householdId)).toHaveLength(3);
  });

  it("stops at the daily cap", async () => {
    await startDemo(db, 2);
    await startDemo(db, 2);
    expect(await startDemo(db, 2)).toBe("limit");
  });
});
