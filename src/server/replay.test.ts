import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, submitPayment, type Deps } from "@/core/lifecycle";
import { seal } from "@/core/seal";
import { REPLAY_SEAL } from "@/agents/tools";
import { replayVideo } from "./replay";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(500), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const KERNEL = "https://prod-iad-x.kernel.sh:8443/browser/replays?jwt=a.b.c&replay_id=r1";
const S3 = "https://kernel-api-prod.s3.us-east-1.amazonaws.com/sessionreplays/o/s/r.mp4?X-Amz-Signature=abc";

let db: Db;
let hh: string;
let other: string;
let paymentId: string;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

beforeEach(async () => {
  db = await pgliteDb();
  const deps: Deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A9", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Aivaras" })).id;
  other = (await createHousehold(db, { name: "Other", spotterName: "Sam" })).id;
  await createSpender(db, { id: "agent", householdId: hh, name: "Shopping agent", kind: "agent", spotterName: "Aivaras", allowance });
  paymentId = (await submitPayment(deps, { spenderId: "agent", money: gbp(1999), payee: { name: "GadgetBarn", isNew: true }, category: "electronics", method: "paypal_order", context: "" })).id;
});

async function withReplay(url: string, at = new Date().toISOString()) {
  const c = { status: "done", verdict: "likely_scam", headline: "h", findings: [], ask: [], calls: [], dropped: 0, model: "m", ms: 1, page: { url: "https://gadgetbarn.example/", finalUrl: "https://gadgetbarn.example/", title: "t", asks: { card: false, login: false, giftCard: false }, replay: { sealed: seal(REPLAY_SEAL, url), at } } };
  await db.query("update payments set case_file = $2 where id = $1", [paymentId, JSON.stringify(c)]);
}

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/payments/x/replay", { headers });

function storage(over: { first?: Response; video?: Response } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === KERNEL) return over.first ?? new Response("", { status: 307, headers: { location: S3 } });
    if (url === S3) {
      const range = new Headers(init?.headers).get("range");
      return over.video ?? (range
        ? new Response("mp4-part", { status: 206, headers: { "content-type": "video/mp4", "content-length": "8", "content-range": "bytes 0-7/100" } })
        : new Response("mp4-bytes", { status: 200, headers: { "content-type": "video/mp4", "content-length": "9" } }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe("replayVideo", () => {
  it("relays KERNEL's mp4 from storage to the household, without ever sending KERNEL's link", async () => {
    await withReplay(KERNEL);
    const f = storage();
    const res = await replayVideo(db, hh, paymentId, req(), { fetch: f });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("cache-control")).toMatch(/private/);
    expect(await res.text()).toBe("mp4-bytes");
    expect(f.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });

  it("passes range requests through, so Safari can play it", async () => {
    await withReplay(KERNEL);
    const res = await replayVideo(db, hh, paymentId, req({ range: "bytes=0-7" }), { fetch: storage() });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-7/100");
  });

  it("is only for the household that owns the payment", async () => {
    await withReplay(KERNEL);
    const f = storage();
    const res = await replayVideo(db, other, paymentId, req(), { fetch: f });
    expect(res.status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it("says the recording expired after a day, without asking KERNEL", async () => {
    await withReplay(KERNEL, new Date(Date.now() - 25 * 3600_000).toISOString());
    const f = storage();
    expect((await replayVideo(db, hh, paymentId, req(), { fetch: f })).status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a sealed link that isn't KERNEL's replay viewer, and a redirect anywhere but storage", async () => {
    await withReplay("https://evil.example/browser/replays?jwt=a");
    const f = storage();
    expect((await replayVideo(db, hh, paymentId, req(), { fetch: f })).status).toBe(404);
    expect(f).not.toHaveBeenCalled();

    await withReplay(KERNEL);
    const bounce = storage({ first: new Response("", { status: 307, headers: { location: "http://169.254.169.254/latest/meta-data" } }) });
    expect((await replayVideo(db, hh, paymentId, req(), { fetch: bounce })).status).toBe(502);
    expect(bounce).toHaveBeenCalledTimes(1);
  });

  it("won't relay something that isn't a video", async () => {
    await withReplay(KERNEL);
    const res = await replayVideo(db, hh, paymentId, req(), { fetch: storage({ video: new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }) }) });
    expect(res.status).toBe(502);
  });

  it("404s when there's no recording, or the seal was tampered with", async () => {
    expect((await replayVideo(db, hh, paymentId, req(), { fetch: storage() })).status).toBe(404);
    await withReplay(KERNEL);
    await db.query(`update payments set case_file = jsonb_set(case_file, '{page,replay,sealed}', '"x.y.z"') where id = $1`, [paymentId]);
    expect((await replayVideo(db, hh, paymentId, req(), { fetch: storage() })).status).toBe(404);
  });
});
