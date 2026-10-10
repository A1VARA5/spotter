import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, getPayment, submitPayment, type Deps } from "@/core/lifecycle";
import { createPairingCode } from "@/core/pairing";
import type { Extracted } from "@/ai/extract";
import { handleTelegramUpdate, type TgCtx, type TgUpdate } from "./inbound";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(50000), askAbove: gbp(5000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };

let db: Db;
let deps: Deps;
let hh: string;
let sent: Array<{ chat: number | string; text: string; extra?: Record<string, unknown> }>;
let ctx: TgCtx;
let extract: ReturnType<typeof vi.fn<(t: string) => Promise<Extracted>>>;
let n = 1;

const found: Extracted = { ok: true, found: true, amountPence: 25000, currency: "GBP", payee: "jamie.k1994@gmail.com", category: "family", method: "paypal_order" } as Extracted;

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
  await createSpender(db, { id: "gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance });
  sent = [];
  extract = vi.fn(async () => found);
  ctx = {
    deps,
    site: "https://spotter.test",
    extract,
    send: async (chat, text, extra) => {
      sent.push({ chat, text, extra });
    },
  };
});

const msg = (chat: number, text: string, over: Record<string, unknown> = {}): TgUpdate => ({
  update_id: n++,
  message: { message_id: n, chat: { id: chat, type: "private" }, from: { id: chat }, text, ...over },
});

async function pairGran(chat = 111) {
  const code = await createPairingCode(db, { householdId: hh, spenderId: "gran", channel: "telegram" });
  return handleTelegramUpdate(ctx, msg(chat, `/start ${code}`));
}

describe("telegram pairing", () => {
  it("/start with a code connects that chat to the person", async () => {
    expect(await pairGran()).toBe("paired");
    const [g] = await db.query<{ telegram_chat_id: string }>("select telegram_chat_id from spenders where id = 'gran'");
    expect(g!.telegram_chat_id).toBe("111");
    expect(sent[0]!.text).toContain("Gran is connected");
  });

  it("a code inside a forwarded message never pairs anyone", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: "gran", channel: "telegram" });
    const out = await handleTelegramUpdate(ctx, msg(222, `Hi, your code is ${code}`, { forward_origin: { type: "user" } }));
    expect(out).toBe("unpaired");
    const [g] = await db.query<{ telegram_chat_id: string | null }>("select telegram_chat_id from spenders where id = 'gran'");
    expect(g!.telegram_chat_id).toBeNull();
  });

  it("a wrong code says so and pairs nothing", async () => {
    expect(await handleTelegramUpdate(ctx, msg(333, "/start SPOT-ABCDEF"))).toBe("unpaired");
    expect(sent[0]!.text).toMatch(/didn.t work/i);
  });

  it("someone who isn't connected is told how to connect, and nothing is checked", async () => {
    expect(await handleTelegramUpdate(ctx, msg(444, "please pay £250 to jamie"))).toBe("unpaired");
    expect(extract).not.toHaveBeenCalled();
    expect(sent[0]!.text).toMatch(/code/i);
  });
});

describe("telegram checks", () => {
  it("a forwarded ask from a connected person is checked and answered in the chat", async () => {
    await pairGran();
    sent = [];
    const out = await handleTelegramUpdate(ctx, msg(111, "Hi mum, new number. Send £250 to jamie.k1994@gmail.com", { forward_origin: { type: "hidden_user" } }));
    expect(out).toBe("checked");
    const [p] = await db.query<{ status: string; request: { context: string } }>("select status, request from payments");
    expect(p!.status).toBe("needs_approval");
    expect(p!.request.context).toContain("forwarded to Spotter on Telegram");
    expect(sent.at(-1)!.text).toContain("on hold");
  });

  it("the same update twice is checked once", async () => {
    await pairGran();
    const u = msg(111, "Send £250 to jamie.k1994@gmail.com");
    await handleTelegramUpdate(ctx, u);
    expect(await handleTelegramUpdate(ctx, u)).toBe("duplicate");
    expect(await db.query("select id from payments")).toHaveLength(1);
  });

  it("says so when there's no request for money in it, and it looks harmless", async () => {
    await pairGran();
    extract.mockResolvedValueOnce({ ok: true, found: false } as Extracted);
    expect(await handleTelegramUpdate(ctx, msg(111, "hello"))).toBe("no_payment");
    expect(sent.at(-1)!.text).toMatch(/no request for money/i);
    expect(sent.at(-1)!.text).toMatch(/no clear warning signs/i);
  });

  it("a lure with no amount yet still gets its scam signs called out", async () => {
    await pairGran();
    extract.mockResolvedValueOnce({ ok: true, found: false } as Extracted);
    deps.check = vi.fn(async () => ({
      ok: true as const,
      flags: [
        { kind: "pressure" as const, severity: "high" as const, quote: "CLAIM 150% DEPOSIT BONUS", why: "Promises of huge returns are how trading scams start." },
        { kind: "other" as const, severity: "medium" as const, quote: "100% free", why: "It's free until they ask for a deposit." },
      ],
      dropped: 0,
      hidden: [],
      summary: "This looks like a fake trading group.",
      injectionAttempt: false,
    }));
    expect(await handleTelegramUpdate(ctx, msg(111, "Who's next?! CLAIM 150% DEPOSIT BONUS, 100% free"))).toBe("scam_signs");
    const t = sent.at(-1)!.text;
    expect(t).toContain("fake trading group");
    expect(t).toContain("CLAIM 150% DEPOSIT BONUS");
    expect(await db.query("select id from payments")).toHaveLength(0);
  });

  it("escapes HTML in everything it repeats back", async () => {
    await pairGran();
    extract.mockResolvedValueOnce({ ...found, payee: "<b>evil</b> & co" } as Extracted);
    await handleTelegramUpdate(ctx, msg(111, "pay <b>evil</b>"));
    expect(sent.at(-1)!.text).toContain("&lt;b&gt;evil&lt;/b&gt; &amp; co");
  });

  it("ignores other bots", async () => {
    expect(await handleTelegramUpdate(ctx, msg(111, "hi", { from: { id: 9, is_bot: true } }))).toBe("ignored");
  });
});

describe("telegram deny button", () => {
  async function held() {
    await db.query("update households set telegram_chat_id = '999' where id = $1", [hh]);
    return submitPayment(deps, { spenderId: "gran", money: gbp(25000), payee: { name: "x@y.com", isNew: true }, category: "family", method: "paypal_order", context: "" });
  }
  const press = (chat: number, data: string): TgUpdate => ({
    update_id: n++,
    callback_query: { id: "cb1", from: { id: chat }, data, message: { message_id: 5, chat: { id: chat, type: "private" } } },
  });

  it("the spotter's own chat can deny a held payment in one tap", async () => {
    const p = await held();
    expect(await handleTelegramUpdate(ctx, press(999, `deny:${p.id}`))).toBe("denied");
    expect((await getPayment(db, p.id))!.status).toBe("voided");
  });

  it("any other chat can't", async () => {
    const p = await held();
    expect(await handleTelegramUpdate(ctx, press(111, `deny:${p.id}`))).toBe("refused");
    expect((await getPayment(db, p.id))!.status).toBe("needs_approval");
  });
});
