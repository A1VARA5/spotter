import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, getPayment, submitPayment, type Deps, type Payment, type Spender } from "@/core/lifecycle";
import { tokenFor, type WasItYou } from "@/core/was-it-you";
import { handleTelegramUpdate, type TgCtx, type TgUpdate } from "./inbound";
import { alertText, askText, makeTelegramAsk, makeTelegramDecided, makeTelegramNotify } from "./notify";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(5000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const HI_TOM = "Hi Mum it's Tom, new number. Can you send £250 to my mate's account today?";

type Sent = { chat: number | string; text: string; extra?: Record<string, unknown> };
type Kb = { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };

let db: Db;
let deps: Deps;
let hh: string;
let sent: Sent[];
let ctx: TgCtx;
let n = 1;
const send = async (chat: number | string, text: string, extra?: Record<string, unknown>) => {
  sent.push({ chat, text, extra });
};

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  sent = [];
  deps = {
    db,
    check: vi.fn(async () => ({
      ok: true as const,
      flags: [],
      dropped: 0,
      hidden: [],
      summary: "x",
      injectionAttempt: false,
      claimedSender: { name: "Tom", relation: "child" as const, quote: "it's Tom" },
    })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A", expiresAt: "2026-11-07T00:00:00Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  deps.ask = makeTelegramAsk(send);
  deps.decided = makeTelegramDecided(send);
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Sam" })).id;
  await createSpender(db, { id: "gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance });
  await createSpender(db, { id: "tom", householdId: hh, name: "Tom", kind: "person", spotterName: "Sam", allowance });
  await db.query("update spenders set telegram_chat_id = '111' where id = 'gran'");
  await db.query("update spenders set telegram_chat_id = '777' where id = 'tom'");
  ctx = { deps, site: "https://spotter.test", extract: vi.fn(), send };
});

const press = (chat: number, data: string): TgUpdate => ({
  update_id: n++,
  callback_query: { id: "cb", from: { id: chat }, data, message: { message_id: 5, chat: { id: chat, type: "private" } } },
});
const held = () =>
  submitPayment(deps, { spenderId: "gran", money: gbp(25000), payee: { name: "jamie@mail.example", isNew: true }, category: "family", method: "paypal_order", context: HI_TOM });

describe("Was it you? on Telegram", () => {
  it("asks Tom in his own chat, in plain words, with Not me and Yes, it's me", async () => {
    await held();
    const ask = sent.find((s) => String(s.chat) === "777")!;
    expect(ask.text).toContain("Did you message Gran from a new number asking for £250.00?");
    expect(ask.text).toContain("it's Tom");
    const row = (ask.extra!.reply_markup as Kb).inline_keyboard[0]!;
    expect(row.map((b) => b.text)).toEqual(["Not me", "Yes, it's me"]);
    for (const b of row) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
  });

  it("Not me from Tom's chat releases the hold and Gran hears it wasn't Tom", async () => {
    const p = await held();
    const data = (sent.find((s) => String(s.chat) === "777")!.extra!.reply_markup as Kb).inline_keyboard[0]![0]!.callback_data!;
    sent = [];
    expect(await handleTelegramUpdate(ctx, press(777, data))).toBe("not_me");
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    expect(sent.find((s) => String(s.chat) === "111")!.text).toContain("It wasn't Tom. Your £250.00 is safe. Ring Tom on the number you already have.");
    expect(sent.find((s) => String(s.chat) === "777")!.text).toMatch(/safe/);
  });

  it("Gran's chat pressing Tom's button, a forged button and a replay all change nothing", async () => {
    const p = await held();
    const w = (await getPayment(db, p.id))!.was_it_you as WasItYou;
    const token = tokenFor(w, p.id);
    expect(await handleTelegramUpdate(ctx, press(111, `wiy:n:${token}`))).toBe("refused");
    expect(await handleTelegramUpdate(ctx, press(777, `wiy:n:${w.id}.${"B".repeat(22)}`))).toBe("refused");
    expect(await handleTelegramUpdate(ctx, press(777, `wiy:y:${token}`))).toBe("it_was_me");
    expect(await handleTelegramUpdate(ctx, press(777, `wiy:n:${token}`))).toBe("refused");
    expect((await getPayment(db, p.id))!.status).toBe("needs_approval");
  });

  it("Yes, it's me says plainly that the spotter still needs the PIN", async () => {
    const p = await held();
    const token = tokenFor((await getPayment(db, p.id))!.was_it_you as WasItYou, p.id);
    sent = [];
    await handleTelegramUpdate(ctx, press(777, `wiy:y:${token}`));
    expect(sent.find((s) => String(s.chat) === "777")!.text).toMatch(/Sam still has to approve it with their PIN/);
  });
});

describe("the spotter's alert", () => {
  const base = {
    id: "pay_1",
    amount: 25000,
    currency: "GBP",
    status: "needs_approval",
    request: { payee: { name: "jamie@mail.example" }, context: HI_TOM },
    decision: null,
    case_file: null,
  } as unknown as Payment;
  const gran = { name: "Gran", household_id: "hh", spotter_name: "Sam" } as Spender;
  const w = (over: Partial<WasItYou>): WasItYou =>
    ({
      id: "wiy_abcdefghijkl",
      who: "Tom",
      claim: { name: "Tom", relation: null, quote: "it's Tom" },
      target: { kind: "spender", spenderId: "tom", name: "Tom" },
      channel: "telegram",
      state: "asked",
      askedAt: "",
      expiresAt: "",
      ...over,
    }) as WasItYou;

  it("says who was asked, or to ring them when they have nothing linked", () => {
    expect(alertText({ ...base, was_it_you: w({}) }, gran)).toContain("Spotter asked Tom if they sent it");
    expect(alertText({ ...base, was_it_you: w({ state: "no_channel", channel: null }) }, gran)).toContain("Ring Tom on the number you already have");
  });

  it("merges the question into the spotter's alert when the message claims to be the spotter", async () => {
    await db.query("update households set telegram_chat_id = '999' where id = $1", [hh]);
    const merged = { ...base, was_it_you: w({ who: "Sam", target: { kind: "spotter", name: "Sam" }, channel: "alert" }) };
    const out: Sent[] = [];
    await makeTelegramNotify(db, "https://s.test", async (chat, text, extra) => void out.push({ chat, text, extra }))(merged, { ...gran, household_id: hh });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain("Did you message Gran");
    const rows = (out[0]!.extra!.reply_markup as Kb).inline_keyboard;
    expect(rows.flat().map((b) => b.text)).toEqual(expect.arrayContaining(["Not me", "Yes, it's me", "Deny"]));
  });

  it("askText leaves out 'from a new number' when the message doesn't say so", () => {
    const p = { ...base, request: { ...base.request, context: "Hi Mum it's Tom, can you send £250" } } as unknown as Payment;
    expect(askText(p, gran, w({}))).toContain("Did you message Gran asking for £250.00?");
  });
});
