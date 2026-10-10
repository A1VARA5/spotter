import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { HH_COOKIE, householdCookie } from "@/server/auth";
import { loadBoard, makeWatchtowerStore, markIncidentsSeen, THREADS_PER_FAMILY } from "./store";

const cookieFor = (hh: string) => `${HH_COOKIE}=${/=([^;]*)/.exec(householdCookie(hh))![1]}`;
const req = (method: string, hh: string | null, body?: unknown) =>
  new Request("http://x/api/watchtower/board", {
    method,
    headers: { ...(hh ? { cookie: cookieFor(hh) } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });

const state = (name = "This month") => ({ pages: [{ id: "month", name, widgets: {} }], selectedPageId: "month", version: "3.0.0" });
const thread = (id: string, updatedAt = 1, extra = "") => ({
  summary: { threadId: id, agentId: "lead", title: `Chat ${id}`, updatedAt },
  messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: `Hello${extra}` }], createdAt: 1 }],
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

describe("watchtower board", () => {
  it("needs a signed in family", async () => {
    const s = makeWatchtowerStore(db);
    expect((await s.putBoard(req("PUT", null, { state: state() }))).status).toBe(401);
  });

  it("saves a board and loads it back for that family only", async () => {
    const s = makeWatchtowerStore(db);
    expect((await s.putBoard(req("PUT", a, { state: state("Mine") }))).status).toBe(200);
    expect((await loadBoard(db, a))?.state).toEqual(state("Mine"));
    expect(await loadBoard(db, b)).toBeNull();
    await s.putBoard(req("PUT", a, { state: state("Again") }));
    expect((await loadBoard(db, a))?.state).toEqual(state("Again"));
  });

  it("refuses something that isn't a Studio board", async () => {
    const s = makeWatchtowerStore(db);
    for (const body of [{ state: null }, { state: { pages: "x", selectedPageId: "m" } }, { state: { pages: [], selectedPageId: "m" } }, { nope: 1 }, "not json"]) {
      expect((await s.putBoard(req("PUT", a, body))).status).toBe(400);
    }
    expect(await loadBoard(db, a)).toBeNull();
  });

  it("refuses a board over the size cap", async () => {
    const s = makeWatchtowerStore(db, { maxBoardBytes: 2000 });
    const big = { ...state(), pages: [{ id: "month", name: "x".repeat(3000), widgets: {} }] };
    expect((await s.putBoard(req("PUT", a, { state: big }))).status).toBe(413);
  });

  it("keeps the incident pages a family has seen when the board is saved again", async () => {
    const s = makeWatchtowerStore(db);
    await markIncidentsSeen(db, a, state(), ["pay_1"]);
    await markIncidentsSeen(db, a, state(), ["pay_2", "pay_1"]);
    await s.putBoard(req("PUT", a, { state: state("Edited") }));
    expect(await loadBoard(db, a)).toEqual({ state: state("Edited"), seen: ["pay_1", "pay_2"] });
  });
});

describe("watchtower chat threads", () => {
  it("needs a signed in family", async () => {
    const s = makeWatchtowerStore(db);
    expect((await s.listThreads(req("GET", null))).status).toBe(401);
    expect((await s.putThread(req("PUT", null, thread("t1")), "t1")).status).toBe(401);
  });

  it("saves, lists oldest first, loads and deletes threads, per family", async () => {
    const s = makeWatchtowerStore(db);
    expect((await s.putThread(req("PUT", a, thread("t2", 5)), "t2")).status).toBe(200);
    expect((await s.putThread(req("PUT", a, thread("t1", 2)), "t1")).status).toBe(200);
    const list = await (await s.listThreads(req("GET", a))).json();
    expect(list.threads.map((t: { threadId: string }) => t.threadId)).toEqual(["t1", "t2"]);
    expect((await (await s.listThreads(req("GET", b))).json()).threads).toEqual([]);

    expect((await (await s.getThread(req("GET", a), "t2")).json()).thread).toEqual(thread("t2", 5));
    expect((await s.getThread(req("GET", b), "t2")).status).toBe(404);

    expect((await s.deleteThread(req("DELETE", b), "t2")).status).toBe(200);
    expect((await s.getThread(req("GET", a), "t2")).status).toBe(200);
    expect((await s.deleteThread(req("DELETE", a), "t2")).status).toBe(200);
    expect((await s.getThread(req("GET", a), "t2")).status).toBe(404);
  });

  it("refuses a thread whose id doesn't match, or that isn't a thread", async () => {
    const s = makeWatchtowerStore(db);
    expect((await s.putThread(req("PUT", a, thread("t1")), "t2")).status).toBe(400);
    expect((await s.putThread(req("PUT", a, { summary: { threadId: "t1" } }), "t1")).status).toBe(400);
    expect((await s.putThread(req("PUT", a, thread("../x")), "../x")).status).toBe(400);
  });

  it("refuses a thread over the size cap", async () => {
    const s = makeWatchtowerStore(db, { maxThreadBytes: 1000 });
    expect((await s.putThread(req("PUT", a, thread("t1", 1, "x".repeat(2000))), "t1")).status).toBe(413);
  });

  it("keeps only the newest threads once a family has too many", async () => {
    const s = makeWatchtowerStore(db);
    for (let i = 0; i < THREADS_PER_FAMILY + 2; i++) await s.putThread(req("PUT", a, thread(`t${i}`, i)), `t${i}`);
    const list = (await (await s.listThreads(req("GET", a))).json()).threads as Array<{ threadId: string }>;
    expect(list).toHaveLength(THREADS_PER_FAMILY);
    expect(list[0]!.threadId).toBe("t2");
    expect(list.at(-1)!.threadId).toBe(`t${THREADS_PER_FAMILY + 1}`);
  });
});
