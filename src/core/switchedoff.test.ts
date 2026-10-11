import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { createSpender, type Deps } from "@/core/lifecycle";
import { createPairingCode, redeemPairingCode } from "@/core/pairing";
import { handlePayPalEvent } from "@/paypal/webhook";
import { handleTelegramUpdate, type TgCtx, type TgUpdate } from "@/telegram/inbound";
import { CONSENT_REVOKED, disconnectedText, dismissWarning, listWarnings } from "./switchedoff";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(50000), askAbove: gbp(5000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };

let db: Db;
let deps: Deps;
let warn: ReturnType<typeof vi.fn<NonNullable<Deps["warn"]>>>;
let mine: string;
let theirs: string;
let n = 1;

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  db = await pgliteDb();
  warn = vi.fn<NonNullable<Deps["warn"]>>(async () => {});
  deps = {
    db,
    warn,
    check: vi.fn(async () => ({ ok: true as const, flags: [], dropped: 0, hidden: [], summary: "", injectionAttempt: false })),
    paypal: { createAuthorizeOrder: vi.fn(), captureAuthorization: vi.fn(), voidAuthorization: vi.fn() },
  };
  mine = (await createHousehold(db, { name: "Sam's household", spotterName: "Sam", paypalUserId: "https://www.paypal.com/webapps/auth/identity/user/AbC123xyz" })).id;
  theirs = (await createHousehold(db, { name: "Stranger's household", spotterName: "Mallory" })).id;
  await createSpender(db, { id: "gran", householdId: mine, name: "Gran", kind: "person", spotterName: "Sam", allowance });
  await createSpender(db, { id: "aunt", householdId: mine, name: "Aunt May", kind: "person", spotterName: "Sam", allowance });
  await createSpender(db, { id: "victim", householdId: theirs, name: "Someone", kind: "person", spotterName: "Mallory", allowance });
});

describe("the words", () => {
  it("says what happened and what to do, plainly", () => {
    expect(disconnectedText("Gran", "chat")).toBe("Gran's chat was just disconnected from Spotter. If they didn't mean to, ring them: scammers often ask people to do this.");
  });
});

describe("PayPal login consent revoked (IDENTITY.AUTHORIZATION-CONSENT.REVOKED)", () => {
  const evt = (resource: Record<string, unknown>, id = `WH-${n++}`) => ({ id, event_type: CONSENT_REVOKED, resource });

  it("tells the household's spotter right away, and keeps it in the app", async () => {
    const r = await handlePayPalEvent(deps, evt({ payer_id: "AbC123xyz" }));
    expect(r.outcome).toBe("spotter_warned");
    expect(warn).toHaveBeenCalledTimes(1);
    const [hh, w] = warn.mock.calls[0]!;
    expect(hh).toBe(mine);
    expect(w.text).toBe(
      "The PayPal login for Sam's household was just disconnected from Spotter. If you didn't mean to, check with the people you look out for: scammers often ask people to do this.",
    );
    expect((await listWarnings(db, mine)).map((x) => x.kind)).toEqual(["paypal_disconnected"]);
    expect(await listWarnings(db, theirs)).toEqual([]);
  });

  it("matches PayPal's full user id too", async () => {
    await handlePayPalEvent(deps, evt({ user_id: "https://www.paypal.com/webapps/auth/identity/user/AbC123xyz" }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a repeated event warns once", async () => {
    await handlePayPalEvent(deps, evt({ payer_id: "AbC123xyz" }, "WH-same"));
    const again = await handlePayPalEvent(deps, evt({ payer_id: "AbC123xyz" }, "WH-same"));
    expect(again.outcome).toBe("duplicate");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("an account Spotter doesn't know is only recorded", async () => {
    const r = await handlePayPalEvent(deps, evt({ payer_id: "SOMEONEELSE" }));
    expect(r.outcome).toBe("unknown_account");
    expect(warn).not.toHaveBeenCalled();
    const [row] = await db.query<{ event_type: string }>("select event_type from paypal_events");
    expect(row?.event_type).toBe(CONSENT_REVOKED);
  });

  it("odd ids never reach SQL as patterns or match by accident", async () => {
    const r = await handlePayPalEvent(deps, evt({ payer_id: "%", user_id: "' or 1=1 --", merchant_id: 12 }));
    expect(r.outcome).toBe("unknown_account");
    expect(warn).not.toHaveBeenCalled();
  });

  it("a channel that fails doesn't fail the webhook, and the warning still shows in the app", async () => {
    warn.mockRejectedValueOnce(new Error("Telegram down"));
    const r = await handlePayPalEvent(deps, evt({ payer_id: "AbC123xyz" }));
    expect(r.outcome).toBe("spotter_warned");
    expect(await listWarnings(db, mine)).toHaveLength(1);
  });
});

describe("a protected person's chat moved to another Spotter family", () => {
  it("warns the family it was taken from", async () => {
    const own = await createPairingCode(db, { householdId: mine, spenderId: "gran", channel: "telegram" });
    await redeemPairingCode(db, own, "telegram", "555", { warn });
    expect(warn).not.toHaveBeenCalled(); // first connection: nothing to warn about
    const stranger = await createPairingCode(db, { householdId: theirs, spenderId: "victim", channel: "telegram" });
    await redeemPairingCode(db, stranger, "telegram", "555", { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(mine);
    expect(warn.mock.calls[0]![1].text).toBe(disconnectedText("Gran", "chat"));
    expect((await listWarnings(db, mine))[0]?.kind).toBe("channel_moved");
    expect(await listWarnings(db, theirs)).toEqual([]);
  });

  it("moving it between people in the same family (the spotter's own code) is not a warning", async () => {
    await redeemPairingCode(db, await createPairingCode(db, { householdId: mine, spenderId: "gran", channel: "email" }), "email", "gran@example.com", { warn });
    await redeemPairingCode(db, await createPairingCode(db, { householdId: mine, spenderId: "aunt", channel: "email" }), "email", "gran@example.com", { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a protected person blocks Spotter's chat", () => {
  let ctx: TgCtx;
  beforeEach(async () => {
    await db.query("update spenders set telegram_chat_id = '777' where id = 'gran'");
    await db.query("update households set telegram_chat_id = '999' where id = $1", [mine]);
    ctx = { deps, site: "https://x", extract: vi.fn(), send: vi.fn(async () => {}) };
  });
  const blocked = (chat: number, status = "kicked", id = n++): TgUpdate => ({
    update_id: id,
    my_chat_member: { chat: { id: chat, type: "private" }, from: { id: chat }, date: 1, old_chat_member: { status: "member" }, new_chat_member: { status } },
  });

  it("tells their spotter, once", async () => {
    const u = blocked(777);
    expect(await handleTelegramUpdate(ctx, u)).toBe("switched_off");
    expect(await handleTelegramUpdate(ctx, u)).toBe("duplicate");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1].text).toBe(
      "Gran just blocked Spotter's chat, so Spotter can't answer them there. If they didn't mean to, ring them: scammers often ask people to do this.",
    );
  });

  it("not when the spotter blocks their own alerts chat, or when someone unblocks", async () => {
    expect(await handleTelegramUpdate(ctx, blocked(999))).toBe("ignored");
    expect(await handleTelegramUpdate(ctx, blocked(777, "member"))).toBe("ignored");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("warnings in the app", () => {
  it("only the owning household can see or dismiss them", async () => {
    await handlePayPalEvent(deps, { id: "WH-x", event_type: CONSENT_REVOKED, resource: { payer_id: "AbC123xyz" } });
    const [w] = await listWarnings(db, mine);
    expect(await dismissWarning(db, theirs, w!.id)).toBe(false);
    expect(await listWarnings(db, mine)).toHaveLength(1);
    expect(await dismissWarning(db, mine, w!.id)).toBe(true);
    expect(await listWarnings(db, mine)).toEqual([]);
  });
});
