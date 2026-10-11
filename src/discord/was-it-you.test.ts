import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, getPayment, submitPayment, type Deps } from "@/core/lifecycle";
import { tokenFor, type WasItYou } from "@/core/was-it-you";
import { runInteraction, type DcCtx } from "./inbound";
import { makeDiscordAsk, makeDiscordDecided, makeDiscordNotify } from "./notify";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(5000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const HI_TOM = "Hi Mum it's Tom, new number. Can you send £250 to my mate's account today?";
type Btn = { label: string; custom_id?: string };

let db: Db;
let deps: Deps;
let ctx: DcCtx;
let dms: Array<{ user: string; content: string; components?: unknown[] }>;
let hh: string;
const dm = async (user: string, content: string, components?: unknown[]) => void dms.push({ user, content, components });

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  dms = [];
  deps = {
    db,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "x", injectionAttempt: false, claimedSender: { name: "Tom", relation: null, quote: "it's Tom" } })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  deps.ask = makeDiscordAsk(dm);
  deps.decided = makeDiscordDecided(dm);
  hh = (await createHousehold(db, { name: "Mine", spotterName: "Sam" })).id;
  await createSpender(db, { id: "gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance });
  await createSpender(db, { id: "tom", householdId: hh, name: "Tom", kind: "person", spotterName: "Sam", allowance });
  await db.query("update spenders set discord_user_id = 'u-gran' where id = 'gran'");
  await db.query("update spenders set discord_user_id = 'u-tom' where id = 'tom'");
  ctx = { deps, site: "https://s.test", extract: vi.fn() };
});

const held = () =>
  submitPayment(deps, { spenderId: "gran", money: gbp(25000), payee: { name: "jamie@mail.example", isNew: true }, category: "family", method: "paypal_order", context: HI_TOM });
const pressAs = (user: string, custom_id: string) => runInteraction(ctx, { type: 3, user: { id: user }, data: { custom_id } });

describe("Was it you? on Discord", () => {
  it("DMs Tom the question with two buttons; Not me from Tom releases it and Gran is told", async () => {
    const p = await held();
    const ask = dms.find((d) => d.user === "u-tom")!;
    expect(ask.content).toContain("Did you message Gran from a new number asking for £250.00?");
    const buttons = (ask.components as Array<{ components: Btn[] }>)[0]!.components;
    expect(buttons.map((b) => b.label)).toEqual(["Not me", "Yes, it's me"]);
    dms = [];
    const r = await pressAs("u-tom", buttons[0]!.custom_id!);
    expect(r.content).toMatch(/safe/);
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    expect(dms.find((d) => d.user === "u-gran")!.content).toContain("It wasn't Tom. Your £250.00 is safe.");
  });

  it("someone else's account pressing Tom's button changes nothing; Yes never pays", async () => {
    const p = await held();
    const token = tokenFor((await getPayment(db, p.id))!.was_it_you as WasItYou, p.id);
    expect((await pressAs("u-gran", `wiy:n:${token}`)).content).toMatch(/isn't valid/);
    expect((await pressAs("u-tom", `wiy:y:${token}`)).content).toMatch(/PIN/);
    expect((await getPayment(db, p.id))!.status).toBe("needs_approval");
    expect(deps.paypal.captureAuthorization).not.toHaveBeenCalled();
  });

  it("the spotter's alert DM carries the question when the message names the spotter", async () => {
    await db.query("update households set discord_user_id = 'u-sam' where id = $1", [hh]);
    deps.check = vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "x", injectionAttempt: false, claimedSender: { name: "Sam", relation: null, quote: "it's Sam" } }));
    deps.notify = makeDiscordNotify(db, "https://s.test", dm);
    await submitPayment(deps, { spenderId: "gran", money: gbp(25000), payee: { name: "j@x.example", isNew: true }, category: "family", method: "paypal_order", context: HI_TOM.replace("Tom", "Sam") });
    const toSam = dms.filter((d) => d.user === "u-sam");
    expect(toSam).toHaveLength(1);
    expect(toSam[0]!.content).toContain("Did you message Gran");
    const labels = (toSam[0]!.components as Array<{ components: Btn[] }>).flatMap((r) => r.components.map((b) => b.label));
    expect(labels).toEqual(expect.arrayContaining(["Not me", "Yes, it's me", "Deny"]));
  });
});
