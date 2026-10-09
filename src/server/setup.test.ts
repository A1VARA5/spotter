import { beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold, getHousehold, listSpenders } from "@/core/households";
import { PRESETS } from "@/core/presets";
import { HH_COOKIE, UNLOCK_COOKIE, householdCookie, unlockCookie, checkPin } from "./auth";
import { makeSetupHandlers } from "./setup";

const val = (c: string) => /=([^;]*)/.exec(c)![1]!;
let db: Db;
let hh: string;
let h: ReturnType<typeof makeSetupHandlers>;

const req = (body: unknown, opts: { unlocked?: boolean; signedIn?: boolean } = {}) => {
  const cookies: string[] = [];
  if (opts.signedIn !== false) cookies.push(`${HH_COOKIE}=${val(householdCookie(hh))}`);
  if (opts.unlocked) cookies.push(`${UNLOCK_COOKIE}=${val(unlockCookie(hh))}`);
  return new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { cookie: cookies.join("; "), "content-type": "application/json" } });
};

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "x", spotterName: "Sam" })).id;
  h = makeSetupHandlers(async () => db);
});

describe("presets", () => {
  it("has the agreed numbers", () => {
    expect(PRESETS.relative.allowance).toMatchObject({ weekly: { amount: 30000 }, askAbove: { amount: 5000 }, blockedCategories: ["gift_cards", "crypto"] });
    expect(PRESETS.kid.allowance).toMatchObject({ weekly: { amount: 1000 }, askAbove: { amount: 500 }, blockedCategories: ["gambling", "crypto", "gift_cards"] });
    expect(PRESETS.agent.allowance).toMatchObject({ weekly: { amount: 40000 }, askAbove: { amount: 3000 }, blockedCategories: ["gift_cards", "crypto", "gambling"] });
    expect(PRESETS.agent.kind).toBe("agent");
    expect(PRESETS.kid.kind).toBe("kid");
    expect(PRESETS.relative.kind).toBe("person");
  });
});

describe("setup", () => {
  it("names the spotter, then sets the PIN once and unlocks", async () => {
    expect((await h.name(req({ spotterName: "  Aivaras " }))).status).toBe(200);
    expect((await getHousehold(db, hh))?.spotter_name).toBe("Aivaras");
    const r = await h.pin(req({ pin: "4821", confirm: "4821" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/spotter_unlock=hh_/);
    expect(await checkPin(db, hh, "4821")).toBe("ok");
    expect((await h.pin(req({ pin: "1111", confirm: "1111" }))).status).toBe(409);
  });

  it("says what is wrong with a PIN", async () => {
    expect((await (await h.pin(req({ pin: "12", confirm: "12" }))).json()).error).toMatch(/4 to 8 digits/);
    expect((await (await h.pin(req({ pin: "4821", confirm: "4822" }))).json()).error).toMatch(/don't match/);
  });

  it("needs a session", async () => {
    expect((await h.name(req({ spotterName: "A" }, { signedIn: false }))).status).toBe(401);
  });

  it("renaming after the PIN is set needs the unlock", async () => {
    await h.pin(req({ pin: "4821", confirm: "4821" }));
    expect((await h.name(req({ spotterName: "B" }))).status).toBe(401);
    expect((await h.name(req({ spotterName: "B" }, { unlocked: true }))).status).toBe(200);
  });
});

describe("people", () => {
  it("adds a person from a preset, only when unlocked", async () => {
    expect((await h.addSpender(req({ name: "Gran", preset: "relative" }))).status).toBe(401);
    const r = await h.addSpender(req({ name: "Gran", preset: "relative" }, { unlocked: true }));
    expect(r.status).toBe(201);
    const [s] = await listSpenders(db, hh);
    expect(s).toMatchObject({ name: "Gran", kind: "person", spotter_name: "Sam" });
    expect(s!.allowance.weekly.amount).toBe(30000);
  });

  it("lets the amounts be changed, but ask above can't exceed the weekly limit", async () => {
    const ok = await h.addSpender(req({ name: "Leo", preset: "kid", weeklyPence: 2000, askAbovePence: 800 }, { unlocked: true }));
    expect((await ok.json()).spender.allowance).toMatchObject({ weekly: { amount: 2000 }, askAbove: { amount: 800 } });
    const bad = await h.addSpender(req({ name: "Leo", preset: "kid", weeklyPence: 500, askAbovePence: 800 }, { unlocked: true }));
    expect(bad.status).toBe(400);
  });

  it("rejects an unknown preset or empty name", async () => {
    expect((await h.addSpender(req({ name: "X", preset: "boss" }, { unlocked: true }))).status).toBe(400);
    expect((await h.addSpender(req({ name: "  ", preset: "kid" }, { unlocked: true }))).status).toBe(400);
  });
});
