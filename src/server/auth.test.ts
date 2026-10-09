import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { checkPin, householdCookie, householdFrom, isUnlocked, requireSpotter, setPin, unlockCookie, HH_COOKIE, UNLOCK_COOKIE } from "./auth";

const value = (setCookie: string) => /=([^;]*)/.exec(setCookie)![1]!;
const req = (cookies: Record<string, string>) =>
  new Request("http://x/api/payments/p/approve", {
    method: "POST",
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
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

describe("household session", () => {
  it("reads the household back from its own cookie", () => {
    expect(householdFrom(req({ [HH_COOKIE]: value(householdCookie(a)) }))).toBe(a);
  });

  it("rejects a tampered or swapped cookie", () => {
    const good = value(householdCookie(a));
    expect(householdFrom(req({ [HH_COOKIE]: good.replace(a, b) }))).toBeNull();
    expect(householdFrom(req({ [HH_COOKIE]: good.slice(0, -2) + "xx" }))).toBeNull();
    expect(householdFrom(req({ [HH_COOKIE]: "" }))).toBeNull();
    expect(householdFrom(req({}))).toBeNull();
  });

  it("an unlock cookie for one household does not unlock another", () => {
    const r = req({ [HH_COOKIE]: value(householdCookie(b)), [UNLOCK_COOKIE]: value(unlockCookie(a)) });
    expect(isUnlocked(r, a)).toBe(true);
    expect(isUnlocked(r, b)).toBe(false);
    expect(requireSpotter(r)).toBeInstanceOf(Response);
  });

  it("requireSpotter gives the household when signed in and unlocked", () => {
    const r = req({ [HH_COOKIE]: value(householdCookie(a)), [UNLOCK_COOKIE]: value(unlockCookie(a)) });
    expect(requireSpotter(r)).toEqual({ householdId: a });
  });

  it("cookies are httpOnly; the unlock is strict and short lived", () => {
    expect(householdCookie(a)).toMatch(/HttpOnly/);
    expect(householdCookie(a)).toMatch(/SameSite=Lax/);
    expect(unlockCookie(a)).toMatch(/SameSite=Strict/);
    expect(unlockCookie(a)).toMatch(/Max-Age=43200/);
  });
});

describe("PIN", () => {
  it("only accepts 4 to 8 digits", async () => {
    await expect(setPin(db, a, "12")).rejects.toThrow();
    await expect(setPin(db, a, "12ab")).rejects.toThrow();
    await setPin(db, a, "482913");
    expect(await checkPin(db, a, "482913")).toBe("ok");
    expect(await checkPin(db, a, "000000")).toBe("wrong");
  });

  it("is per household and never stored in plain text", async () => {
    await setPin(db, a, "1111");
    await setPin(db, b, "2222");
    expect(await checkPin(db, a, "2222")).toBe("wrong");
    const rows = await db.query<{ pin_hash: string }>("select pin_hash from households where id = $1", [a]);
    expect(rows[0]!.pin_hash).not.toContain("1111");
  });

  it("locks after 5 wrong tries, even for the right PIN", async () => {
    await setPin(db, a, "1111");
    for (let i = 0; i < 5; i++) expect(await checkPin(db, a, "9999")).toBe("wrong");
    expect(await checkPin(db, a, "1111")).toBe("locked");
  });

  it("a household with no PIN can't be unlocked", async () => {
    expect(await checkPin(db, a, "1234")).toBe("wrong");
  });
});
