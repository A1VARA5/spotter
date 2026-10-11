import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, submitPayment, type Deps } from "@/core/lifecycle";
import { seal } from "@/core/seal";
import { closePeek, PEEK, PEEK_SEAL, peekActivity, peekFrame, peekScroll, startPeek, sweepPeeks, type PeekKernel } from "./peek";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(500), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const SHOP = "https://gadgetbarn.example/deal";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let db: Db;
let hh: string;
let other: string;
let paymentId: string;
let n = 0;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

function fakeKernel(over: Partial<{ create: () => Promise<{ session_id: string }>; shot: () => Promise<Response>; del: () => Promise<unknown> }> = {}) {
  const k = {
    browsers: {
      create: vi.fn(over.create ?? (async () => ({ session_id: `sess_${++n}` }))),
      deleteByID: vi.fn(over.del ?? (async () => undefined)),
      computer: {
        captureScreenshot: vi.fn(over.shot ?? (async () => new Response(PNG, { headers: { "content-type": "image/png" } }))),
        scroll: vi.fn(async () => undefined),
      },
    },
  };
  return k satisfies PeekKernel;
}

const pub = async () => true;
const opts = (kernel: PeekKernel, extra: Record<string, unknown> = {}) => ({ kernel, isPublicHost: pub, ...extra });

async function addPayment(householdId: string, spenderId: string, context: string) {
  const deps: Deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A9", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  return (await submitPayment(deps, { spenderId, money: gbp(1999), payee: { name: "GadgetBarn", isNew: true }, category: "electronics", method: "paypal_order", context })).id;
}

async function withPage(id: string, url = SHOP) {
  const c = { status: "done", verdict: "likely_scam", headline: "h", findings: [], ask: [], calls: [], dropped: 0, model: "m", ms: 1, page: { url, finalUrl: url, title: "t", asks: { card: false, login: false, giftCard: false } } };
  await db.query("update payments set case_file = $2 where id = $1", [id, JSON.stringify(c)]);
}

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Aivaras" })).id;
  other = (await createHousehold(db, { name: "Other", spotterName: "Sam" })).id;
  await createSpender(db, { id: "agent", householdId: hh, name: "Shopping agent", kind: "agent", spotterName: "Aivaras", allowance });
  await createSpender(db, { id: "agent2", householdId: other, name: "Their agent", kind: "agent", spotterName: "Sam", allowance });
  paymentId = await addPayment(hh, "agent", `Buy the earbuds at ${SHOP} now`);
  await withPage(paymentId);
});

const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe("startPeek", () => {
  it("opens the case file's page in a fresh headful browser with no profile and a short inactivity backstop", async () => {
    const k = fakeKernel();
    const res = await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.secondsLeft).toBeGreaterThan(80);
    expect(b.secondsLeft).toBeLessThanOrEqual(PEEK.seconds);
    const arg = (k.browsers.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg).toMatchObject({ headless: false, start_url: SHOP, timeout_seconds: PEEK.backstopSeconds });
    expect(arg.profile).toBeUndefined();
    expect(arg.viewport).toEqual({ width: 1024, height: 768 });
  });

  it("uses a phone sized screen when asked", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "phone", opts(k));
    expect(((k.browsers.create.mock.calls[0] as unknown[])[0] as { viewport: unknown }).viewport).toEqual({ width: 390, height: 844 });
  });

  it("never sends KERNEL's session id to the browser, and keeps it sealed in the database", async () => {
    const k = fakeKernel();
    const res = await startPeek(db, hh, paymentId, "desktop", opts(k));
    const text = await res.text();
    expect(text).not.toContain("sess_");
    expect(text).not.toContain("kernel");
    const rows = await db.query<{ session_sealed: string }>("select session_sealed from peeks");
    expect(rows[0]!.session_sealed).toBeTruthy();
    expect(rows[0]!.session_sealed).not.toContain("sess_");
  });

  it("is only for the household that owns the payment", async () => {
    const k = fakeKernel();
    const res = await startPeek(db, other, paymentId, "desktop", opts(k));
    expect(res.status).toBe(404);
    expect(k.browsers.create).not.toHaveBeenCalled();
  });

  it("refuses a payment with no opened page on its case file", async () => {
    await db.query("update payments set case_file = null where id = $1", [paymentId]);
    const k = fakeKernel();
    expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(404);
    expect(k.browsers.create).not.toHaveBeenCalled();
  });

  it("refuses a case file page that isn't a link from the payment's own message", async () => {
    await withPage(paymentId, "https://somewhere-else.example/");
    const k = fakeKernel();
    expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(400);
    expect(k.browsers.create).not.toHaveBeenCalled();
  });

  it("refuses links to private or local addresses, even when they are in the message", async () => {
    for (const url of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://localhost:3000/"]) {
      const id = await addPayment(hh, "agent", `look ${url}`);
      await withPage(id, url);
      const k = fakeKernel();
      const res = await startPeek(db, hh, id, "desktop", { kernel: k });
      expect(res.status, url).toBe(400);
      expect(k.browsers.create).not.toHaveBeenCalled();
    }
  });

  it("refuses anything but http and https", async () => {
    const id = await addPayment(hh, "agent", "see javascript:alert(1) and file:///etc/passwd");
    await withPage(id, "file:///etc/passwd");
    const k = fakeKernel();
    expect((await startPeek(db, hh, id, "desktop", opts(k))).status).toBe(400);
  });

  it("allows one live browser per household at a time", async () => {
    const k = fakeKernel();
    expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(200);
    const second = await addPayment(hh, "agent", `again ${SHOP}`);
    await withPage(second);
    expect((await startPeek(db, hh, second, "desktop", opts(k))).status).toBe(409);
    expect(k.browsers.create).toHaveBeenCalledTimes(1);
  });

  it("stops at the household's daily cap", async () => {
    const k = fakeKernel();
    for (let i = 0; i < PEEK.perHouseholdDaily; i++) {
      expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(200);
      await closePeek(db, hh, paymentId, { kernel: k });
    }
    const res = await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect(res.status).toBe(429);
    expect(k.browsers.create).toHaveBeenCalledTimes(PEEK.perHouseholdDaily);
  });

  it("stops at the global daily cap", async () => {
    const k = fakeKernel();
    for (let i = 0; i < PEEK.globalDaily; i++) {
      await db.query("insert into peeks (id, household_id, payment_id, view, ends_at, closed_at) values ($1, $2, $3, 'desktop', now(), now())", [`old_${i}`, other, paymentId]);
    }
    expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(429);
    expect(k.browsers.create).not.toHaveBeenCalled();
  });

  it("says so when KERNEL isn't set up", async () => {
    const res = await startPeek(db, hh, paymentId, "desktop", { isPublicHost: pub, apiKey: "" });
    expect(res.status).toBe(503);
  });

  it("a browser that fails to start leaves no open peek behind", async () => {
    const k = fakeKernel({ create: async () => Promise.reject(new Error("boom")) });
    expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(502);
    const open = await db.query("select 1 from peeks where closed_at is null");
    expect(open).toHaveLength(0);
  });

  it("deletes the browser when the peek was closed while it was starting", async () => {
    let release!: (v: { session_id: string }) => void;
    const k = fakeKernel({ create: () => new Promise((r) => (release = r)) });
    const starting = startPeek(db, hh, paymentId, "desktop", opts(k));
    await vi.waitFor(() => expect(k.browsers.create).toHaveBeenCalled());
    await closePeek(db, hh, paymentId, { kernel: k });
    release({ session_id: "sess_late" });
    expect((await starting).status).toBe(409);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess_late");
  });

  it("deletes a browser that only arrives after starting timed out", async () => {
    let release!: (v: { session_id: string }) => void;
    const k = fakeKernel({ create: () => new Promise((r) => (release = r)) });
    const res = await startPeek(db, hh, paymentId, "desktop", { ...opts(k), createMs: 20 });
    expect(res.status).toBe(502);
    release({ session_id: "sess_slow" });
    await vi.waitFor(() => expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess_slow"));
  });

  it("deletes the browser if sealing its id fails after it was created", async () => {
    const k = fakeKernel();
    const res = await startPeek(db, hh, paymentId, "desktop", { ...opts(k), seal: () => { throw new Error("no key"); } });
    expect(res.status).toBe(500);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess_" + n);
    expect(await db.query("select 1 from peeks where closed_at is null")).toHaveLength(0);
  });

  it("ends and deletes browsers that ran past their time before starting a new one", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    const first = "sess_" + n;
    await db.query("update peeks set ends_at = now() - interval '1 second'");
    expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(200);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith(first);
  });
});

describe("sweeping and caps after failures", () => {
  it("deletes every expired browser at once, not one after another", async () => {
    const pending: Array<() => void> = [];
    const k = fakeKernel({ del: () => new Promise<void>((r) => pending.push(r)) });
    for (const [i, h] of [hh, other].entries()) {
      await db.query("insert into peeks (id, household_id, payment_id, view, ends_at, session_sealed) values ($1, $2, $3, 'desktop', now() - interval '1 second', $4)", [
        `exp_${i}`,
        h,
        paymentId,
        seal(PEEK_SEAL, `sess_exp_${i}`),
      ]);
    }
    const sweeping = sweepPeeks(db, k);
    await vi.waitFor(() => expect(k.browsers.deleteByID).toHaveBeenCalledTimes(2));
    pending.forEach((r) => r());
    expect(await sweeping).toBe(2);
  });

  it("clears a start that died half way, so the family isn't locked out", async () => {
    await db.query("insert into peeks (id, household_id, payment_id, view, ends_at, started_at) values ('stuck', $1, $2, 'desktop', now() + interval '60 seconds', now() - interval '40 seconds')", [hh, paymentId]);
    const k = fakeKernel();
    expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(200);
  });

  it("failed starts don't use up the family's looks", async () => {
    const k = fakeKernel({ create: async () => Promise.reject(new Error("boom")) });
    for (let i = 0; i < PEEK.perHouseholdDaily + 1; i++) expect((await startPeek(db, hh, paymentId, "desktop", opts(k))).status).toBe(502);
  });

  it("never writes a KERNEL session id into the logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const k = fakeKernel({ del: async () => Promise.reject(new Error("browser sess_abcdef0123456789abcd not found")) });
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    await closePeek(db, hh, paymentId, { kernel: k });
    const logged = spy.mock.calls.flat().map(String).join(" ");
    spy.mockRestore();
    expect(logged).toContain("deleting");
    expect(logged).not.toMatch(/sess_[a-z0-9]{10,}/);
  });
});

describe("peekFrame", () => {
  it("relays a fresh picture of the page to the owner, never cached", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    const res = await peekFrame(db, hh, paymentId, { kernel: k });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(k.browsers.computer.captureScreenshot).toHaveBeenCalledWith("sess_" + n);
  });

  it("shows nothing to another household", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    const res = await peekFrame(db, other, paymentId, { kernel: k });
    expect(res.status).toBe(410);
    expect(k.browsers.computer.captureScreenshot).not.toHaveBeenCalled();
  });

  it("after the time is up, deletes the browser and answers 410", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    await db.query("update peeks set ends_at = now() - interval '1 second'");
    const res = await peekFrame(db, hh, paymentId, { kernel: k });
    expect(res.status).toBe(410);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess_" + n);
    expect(k.browsers.computer.captureScreenshot).not.toHaveBeenCalled();
  });

  it("refuses frames asked for faster than the relay allows", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await peekFrame(db, hh, paymentId, { kernel: k })).status).toBe(200);
    expect((await peekFrame(db, hh, paymentId, { kernel: k })).status).toBe(429);
  });

  it("closes the peek when KERNEL says the browser is gone", async () => {
    const gone = Object.assign(new Error("not found"), { status: 404 });
    const k = fakeKernel({ shot: async () => Promise.reject(gone) });
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await peekFrame(db, hh, paymentId, { kernel: k })).status).toBe(410);
    expect(await db.query("select 1 from peeks where closed_at is null")).toHaveLength(0);
  });

  it("only relays a PNG", async () => {
    const k = fakeKernel({ shot: async () => new Response("<html>", { headers: { "content-type": "text/html" } }) });
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await peekFrame(db, hh, paymentId, { kernel: k })).status).toBe(502);
  });
});

describe("peekScroll", () => {
  it("scrolls the page up or down and does nothing else", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await peekScroll(db, hh, paymentId, "down", { kernel: k })).status).toBe(200);
    expect((await peekScroll(db, hh, paymentId, "up", { kernel: k })).status).toBe(200);
    const calls = k.browsers.computer.scroll.mock.calls.map((c) => (c as unknown[])[1] as { delta_y: number; x: number; y: number });
    expect(calls[0]!.delta_y).toBeGreaterThan(0);
    expect(calls[1]!.delta_y).toBeLessThan(0);
    expect(calls[0]).toMatchObject({ x: 512, y: 384 });
  });

  it("counts every scroll that worked, for the proof that the spotter only ever scrolled", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    await peekScroll(db, hh, paymentId, "down", { kernel: k });
    await peekScroll(db, hh, paymentId, "down", { kernel: k });
    k.browsers.computer.scroll.mockRejectedValueOnce(new Error("500"));
    await peekScroll(db, hh, paymentId, "up", { kernel: k });
    expect(await peekActivity(db, paymentId)).toEqual({ peeks: 1, scrolls: 2 });
  });

  it("refuses anything that isn't up or down", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await peekScroll(db, hh, paymentId, "click" as never, { kernel: k })).status).toBe(400);
    expect(k.browsers.computer.scroll).not.toHaveBeenCalled();
  });

  it("can't scroll another household's peek", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await peekScroll(db, other, paymentId, "down", { kernel: k })).status).toBe(410);
    expect(k.browsers.computer.scroll).not.toHaveBeenCalled();
  });
});

describe("closePeek", () => {
  it("deletes the browser and ends the peek, and closing twice is fine", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await closePeek(db, hh, paymentId, { kernel: k })).status).toBe(200);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess_" + n);
    expect((await closePeek(db, hh, paymentId, { kernel: k })).status).toBe(200);
    expect(k.browsers.deleteByID).toHaveBeenCalledTimes(1);
    expect((await peekFrame(db, hh, paymentId, { kernel: k })).status).toBe(410);
  });

  it("another household can't close mine", async () => {
    const k = fakeKernel();
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    await closePeek(db, other, paymentId, { kernel: k });
    expect(k.browsers.deleteByID).not.toHaveBeenCalled();
    expect(await db.query("select 1 from peeks where closed_at is null")).toHaveLength(1);
  });

  it("still ends the peek when KERNEL's delete fails (its inactivity timeout ends the browser)", async () => {
    const k = fakeKernel({ del: async () => Promise.reject(new Error("down")) });
    await startPeek(db, hh, paymentId, "desktop", opts(k));
    expect((await closePeek(db, hh, paymentId, { kernel: k })).status).toBe(200);
    expect(await db.query("select 1 from peeks where closed_at is null")).toHaveLength(0);
  });
});
