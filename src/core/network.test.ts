import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "./households";
import { fileReport, networkCount, networkLine, reportKey } from "./network";

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
    expect(reportKey(" Jamie.K1994@Mail.Example ")).toBe(reportKey("jamie.k1994@mail.example"));
    expect(reportKey("jamie.k1994@mail.example​")).toBe(reportKey("jamie.k1994@mail.example"));
  });

  it("never contains the identifier itself", () => {
    expect(reportKey("jamie.k1994@mail.example")).not.toContain("jamie");
    expect(reportKey("jamie.k1994@mail.example")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("network", () => {
  it("counts other families that said no, not your own", async () => {
    await fileReport(db, { householdId: a, identifier: "jamie.k1994@mail.example", kind: "denied" });
    await fileReport(db, { householdId: b, identifier: "Jamie.K1994@mail.example", kind: "blocked" });
    expect((await networkCount(db, "jamie.k1994@mail.example", c)).families).toBe(2);
    expect((await networkCount(db, "jamie.k1994@mail.example", a)).families).toBe(1);
  });

  it("counts a family once however often it reports", async () => {
    await fileReport(db, { householdId: a, identifier: "x@y.com", kind: "denied" });
    await fileReport(db, { householdId: a, identifier: "x@y.com", kind: "blocked" });
    expect((await networkCount(db, "x@y.com", c)).families).toBe(1);
  });

  it("stores no raw identifier", async () => {
    await fileReport(db, { householdId: a, identifier: "jamie.k1994@mail.example", kind: "denied" });
    const rows = await db.query<Record<string, unknown>>("select * from reports");
    expect(JSON.stringify(rows)).not.toContain("jamie");
  });

  it("forgets reports older than the window", async () => {
    await fileReport(db, { householdId: a, identifier: "x@y.com", kind: "denied" });
    await db.query("update reports set at = now() - interval '31 days'");
    expect((await networkCount(db, "x@y.com", c)).families).toBe(0);
  });

  it("keeps demo families and real families apart, and says which ones it counted", async () => {
    const d1 = (await createHousehold(db, { name: "D1", spotterName: "Sam", demo: true })).id;
    const d2 = (await createHousehold(db, { name: "D2", spotterName: "Sam", demo: true })).id;
    await fileReport(db, { householdId: d1, identifier: "GadgetBarn", kind: "blocked" });
    await fileReport(db, { householdId: a, identifier: "GadgetBarn", kind: "denied" });
    // A demo visitor only hears about other demo families; a real family never counts demo clicks.
    expect(await networkCount(db, "GadgetBarn", d2)).toMatchObject({ families: 1, demo: true });
    expect(await networkCount(db, "GadgetBarn", b)).toMatchObject({ families: 1, demo: false });
  });

  it("an unknown household never sees real families' reports: it is counted as a demo one, and warned about", async () => {
    await fileReport(db, { householdId: a, identifier: "GadgetBarn", kind: "denied" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await networkCount(db, "GadgetBarn", "hh_missing")).toMatchObject({ families: 0, demo: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("labels demo counts as demo families, in plain words", () => {
    expect(networkLine({ families: 7, demo: true }, "GadgetBarn")).toBe(
      "7 other demo families (other people trying the demo) said no to GadgetBarn in the last 30 days.",
    );
    expect(networkLine({ families: 1, demo: false }, "GadgetBarn")).toBe("1 other Spotter family said no to GadgetBarn in the last 30 days.");
    expect(networkLine({ families: 0, demo: true }, "GadgetBarn")).toBe("No other demo family has said no to GadgetBarn in the last 30 days.");
  });

  it("ignores empty identifiers", async () => {
    await fileReport(db, { householdId: a, identifier: "   ", kind: "denied" });
    expect(await db.query("select * from reports")).toHaveLength(0);
  });
});
