import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, getPayment, submitPayment, type Deps } from "@/core/lifecycle";
import { createPairingCode } from "@/core/pairing";
import type { Extracted } from "@/ai/extract";
import { readMessage, runInteraction, type DcCtx, type Interaction } from "./inbound";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(50000), askAbove: gbp(5000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const found = { ok: true, found: true, amountPence: 4000, currency: "GBP", payee: "skinz-trade.gg", category: "games", method: "gift_card" } as Extracted;

let db: Db;
let deps: Deps;
let hh: string;
let ctx: DcCtx;
let extract: ReturnType<typeof vi.fn<(t: string) => Promise<Extracted>>>;

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Sam" })).id;
  await createSpender(db, { id: "leo", householdId: hh, name: "Leo", kind: "kid", spotterName: "Sam", allowance });
  extract = vi.fn(async () => found);
  ctx = { deps, site: "https://spotter.test", extract };
});

const slash = (user: string, sub: string, options: Array<{ name: string; value: string }> = []): Interaction => ({
  type: 2,
  user: { id: user },
  data: { type: 1, name: "spotter", options: [{ type: 1, name: sub, options }] },
});
const rightClick = (user: string, content: string, extra: Record<string, unknown> = {}): Interaction => ({
  type: 2,
  member: { user: { id: user } },
  data: { type: 3, name: "Check with Spotter", target_id: "m1", resolved: { messages: { m1: { content, ...extra } } } },
});

async function connectLeo(user = "1001") {
  const code = await createPairingCode(db, { householdId: hh, spenderId: "leo", channel: "discord" });
  return runInteraction(ctx, slash(user, "connect", [{ name: "code", value: code }]));
}

describe("discord", () => {
  it("/spotter connect pairs the Discord account", async () => {
    expect((await connectLeo()).content).toContain("Leo is connected");
  });

  it("a wrong code pairs nothing", async () => {
    expect((await runInteraction(ctx, slash("1001", "connect", [{ name: "code", value: "SPOT-ABCDEF" }]))).content).toMatch(/didn.t work/i);
  });

  it("right click on a message asking for money checks it for the connected person", async () => {
    await connectLeo();
    const r = await runInteraction(ctx, rightClick("1001", "Free skins! Send a £40 Steam gift card to skinz-trade.gg"));
    const [p] = await db.query<{ status: string; request: { context: string } }>("select status, request from payments");
    expect(p!.status).toBe("blocked");
    expect(p!.request.context).toContain("Discord");
    expect(r.content).toMatch(/not paid/i);
  });

  it("someone who isn't connected gets told how, and nothing is checked", async () => {
    const r = await runInteraction(ctx, rightClick("5555", "pay me £40"));
    expect(r.content).toContain("/spotter connect");
    expect(extract).not.toHaveBeenCalled();
  });

  it("reads embeds, link buttons and forwarded messages too", () => {
    const text = readMessage({
      content: "",
      embeds: [{ title: "Claim", description: "Pay £40", url: "https://skinz.gg" }],
      components: [{ components: [{ label: "Pay now", url: "https://pay.skinz.gg" }] }],
      message_snapshots: [{ message: { content: "forwarded ask" } }],
    });
    expect(text).toContain("Pay £40");
    expect(text).toContain("https://pay.skinz.gg");
    expect(text).toContain("forwarded ask");
  });

  it("the spotter's Deny button works only for the spotter's own Discord account", async () => {
    await db.query("update households set discord_user_id = '2002' where id = $1", [hh]);
    const p = await submitPayment(deps, { spenderId: "leo", money: gbp(4000), payee: { name: "shop", isNew: true }, category: "games", method: "paypal_order", context: "" });
    const press = (user: string): Interaction => ({ type: 3, user: { id: user }, data: { custom_id: `deny:${p.id}` } });
    expect((await runInteraction(ctx, press("1001"))).content).toMatch(/only/i);
    expect((await getPayment(db, p.id))!.status).toBe("needs_approval");
    expect((await runInteraction(ctx, press("2002"))).content).toMatch(/denied/i);
    expect((await getPayment(db, p.id))!.status).toBe("voided");
  });

  it("a lure with no amount still gets told what's wrong", async () => {
    await connectLeo();
    extract.mockResolvedValueOnce({ ok: true, found: false } as Extracted);
    deps.check = vi.fn(async () => ({ ok: true as const, flags: [{ kind: "pressure" as const, severity: "high" as const, quote: "FREE NITRO", why: "Free Nitro links steal accounts." }], dropped: 0, hidden: [], summary: "A fake Nitro giveaway.", injectionAttempt: false }));
    const r = await runInteraction(ctx, rightClick("1001", "FREE NITRO click here"));
    expect(r.content).toContain("signs of a scam");
    expect(r.content).toContain("FREE NITRO");
  });
});
