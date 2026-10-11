// Security review 2026-10-11 (docs/reviews/security-2026-10-11.md): proof tests for the changes since 399969f.
// Each test asserts the SAFE behaviour, so each one FAILS on the reviewed code and passes once the finding is fixed.
// No network: KERNEL, Channel3 and the alert senders are fakes, the database is PGlite.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, submitPayment, type Deps } from "@/core/lifecycle";
import { PEEK, startPeek, type PeekKernel } from "@/server/peek";
import { startWatch, type WatchC3, type WatchDeps, type WatchView } from "@/core/watch";
import type { Product } from "@/market/channel3";
import { handleChannel3Webhook } from "@/market/webhook";
import { makeDropNotify } from "@/server/watch-notify";
import { safeToFetch } from "@/agents/links";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(500), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const SHOP = "https://gadgetbarn.example/deal";

let db: Db;
let hh: string;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Aivaras" })).id;
  await createSpender(db, { id: "agent", householdId: hh, name: "Shopping agent", kind: "agent", spotterName: "Aivaras", allowance });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function heldPaymentWithPage(page: { url: string; finalUrl: string }) {
  const deps: Deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A9", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  const id = (await submitPayment(deps, { spenderId: "agent", money: gbp(1999), payee: { name: "GadgetBarn", isNew: true }, category: "electronics", method: "paypal_order", context: `Buy the earbuds at ${page.url} now` })).id;
  const c = { status: "done", verdict: "likely_scam", headline: "h", findings: [], ask: [], calls: [], dropped: 0, model: "m", ms: 1, page: { ...page, title: "t", asks: { card: false, login: false, giftCard: false } } };
  await db.query("update payments set case_file = $2 where id = $1", [id, JSON.stringify(c)]);
  return id;
}

function fakeKernel(create: () => Promise<{ session_id: string }>) {
  return {
    browsers: {
      create: vi.fn(create),
      deleteByID: vi.fn(async () => undefined),
      computer: { captureScreenshot: vi.fn(async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))), scroll: vi.fn(async () => undefined) },
    },
  } satisfies PeekKernel;
}

// Stand in for safeToFetch without DNS: the shop's host is public, link local and private ranges are not.
const isPublicHost = async (host: string) => !/^(169\.254\.|10\.|127\.|192\.168\.)/.test(host);

describe("F1 peek: the case file already shows the link redirected to a private address", () => {
  it("does not open a KERNEL browser on a link whose recorded final address is link local", async () => {
    // The case agent's own visit recorded where the link really went (finalUrl). The peek checks only the first hop.
    const id = await heldPaymentWithPage({ url: SHOP, finalUrl: "http://169.254.169.254/latest/meta-data/" });
    const k = fakeKernel(async () => ({ session_id: "sess_1" }));
    const res = await startPeek(db, hh, id, "desktop", { kernel: k, isPublicHost });
    expect(k.browsers.create).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });
});

describe("F2 peek: starts that fail don't count towards the daily caps", () => {
  it("never asks KERNEL for more browsers than the household's daily cap, even when every start times out", async () => {
    const id = await heldPaymentWithPage({ url: SHOP, finalUrl: SHOP });
    // A browser that never answers in time (a slow start URL, KERNEL busy). Each create is still a billed browser.
    const k = fakeKernel(() => new Promise<never>(() => {}));
    for (let i = 0; i < PEEK.perHouseholdDaily + 3; i++) await startPeek(db, hh, id, "desktop", { kernel: k, isPublicHost, createMs: 5 });
    expect(k.browsers.create.mock.calls.length).toBeLessThanOrEqual(PEEK.perHouseholdDaily);
  });
});

describe("F3 price watch: Channel3 searches (1 credit each) are not capped", () => {
  let c3: { [K in keyof WatchC3]: ReturnType<typeof vi.fn> };
  let deps: WatchDeps;
  const product = (id: string): Product => ({ id, title: "Pro wireless earbuds 2", offers: [{ title: "Pro wireless earbuds 2", domain: "fair.example", price: 15900, currency: "GBP", url: "https://fair.example/p" }] });

  beforeEach(() => {
    c3 = {
      search: vi.fn(async () => [] as Product[]),
      start: vi.fn(async () => "active"),
      stop: vi.fn(async () => true),
      history: vi.fn(async () => null),
      product: vi.fn(async () => null),
    };
    deps = { db, c3: c3 as unknown as WatchC3 };
  });

  it("stops spending searches on a family that keeps asking for products Channel3 can't find", async () => {
    for (let i = 0; i < 25; i++) await startWatch(deps, { householdId: hh, spenderId: "agent", item: `made up gadget ${i}`, currency: "GBP", nearly: 5000, createdBy: "agent" });
    // An agent in a loop (MCP watch_price with item) gets a search per call: 25 calls, 25 credits, no daily wall.
    expect(c3.search.mock.calls.length).toBeLessThan(25);
  });

  it("doesn't spend a search again for a product the family is already watching", async () => {
    c3.search.mockImplementation(async () => [product("X2abc")]);
    for (let i = 0; i < 5; i++) await startWatch(deps, { householdId: hh, spenderId: "agent", item: "Pro wireless earbuds 2", currency: "GBP", nearly: 21900, createdBy: "agent" });
    expect(c3.start).toHaveBeenCalledTimes(1); // only one watch was really made
    expect(c3.search.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("F4 Channel3 webhook: no secret means anyone can trigger checks", () => {
  it("refuses deliveries when CHANNEL3_WEBHOOK_SECRET is unset instead of accepting them unsigned", async () => {
    const hint = vi.fn(async () => 1);
    const req = new Request("https://spotter.example/api/channel3/webhook", { method: "POST", body: JSON.stringify({ type: "price.changed", canonical_product_id: "VpRxZ86" }) });
    const res = await handleChannel3Webhook(req, undefined, hint);
    expect(hint).not.toHaveBeenCalled();
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("F5 price drop notice: Discord markdown in the item isn't neutralised", () => {
  it("doesn't let an item name become a masked link in the spotter's Discord DM", async () => {
    await db.query("update households set discord_user_id = '222' where id = $1", [hh]);
    const dm = vi.fn(async (_id: string, _text: string) => {});
    const w: WatchView & { householdId: string } = {
      id: "watch_1", householdId: hh, paymentId: null, who: "Shopping agent",
      item: "earbuds 2 [Open Spotter](https://example.invalid/)", // benign stand in: any link text the agent chose
      title: "Pro wireless earbuds 2", currency: "GBP", nearlyPaid: 8900, target: 7600,
      best: { price: 6900, shop: "fair.example", url: "https://fair.example/p" }, saving: 2000, status: "dropped",
      history: null, createdAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-15T00:00:00Z", lastCheckedAt: null, example: false, createdBy: "agent",
    };
    await makeDropNotify(db, "https://site", { discord: dm })(w);
    const text = dm.mock.calls[0]![1];
    expect(text).not.toMatch(/\[[^\]]*\]\(https?:\/\/[^)]*\)/);
  });
});

describe("F6 private address guard: IPv6 forms that embed an IPv4 address", () => {
  it("treats NAT64 and 6to4 forms of the cloud metadata address as private", async () => {
    expect(await safeToFetch("64:ff9b::a9fe:a9fe")).toBe(false); // 64:ff9b::169.254.169.254
    expect(await safeToFetch("2002:a9fe:a9fe::")).toBe(false); // 6to4 of 169.254.169.254
  });
});
