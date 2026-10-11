import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb, type Db } from "@/db";
import { approve, createSpender, getPayment, listEvents, submitPayment, type Deps, type Payment } from "./lifecycle";
import { PayPalError } from "@/paypal/client";
import { alertText } from "@/telegram/notify";
import { alertContent } from "@/discord/notify";
import { alertEmail } from "@/email/alerts";
import { askAgainDue, askAgainTomorrow, holdEndLine, holdEndsAt, keepHoldsAlive, nextNineAm, whenText } from "./sleep";

const DAY = 24 * 3600_000;
const gbp = (amount: number) => ({ amount, currency: "GBP" as const });

describe("nextNineAm (tomorrow at 9am, household time)", () => {
  it("is 9am the next day in London summer time (8am UTC)", () => {
    expect(nextNineAm(new Date("2026-10-11T15:30:00Z"), "Europe/London").toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });
  it("is 9am the next day in London winter time (9am UTC)", () => {
    expect(nextNineAm(new Date("2026-11-03T20:00:00Z"), "Europe/London").toISOString()).toBe("2026-11-04T09:00:00.000Z");
  });
  it("follows the clocks going back overnight (25 Oct 2026)", () => {
    expect(nextNineAm(new Date("2026-10-24T22:00:00Z"), "Europe/London").toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });
  it("uses the household's local date, not UTC's", () => {
    // 23:30 UTC on the 11th is already the 12th in Tokyo, so tomorrow there is the 13th.
    expect(nextNineAm(new Date("2026-10-11T23:30:00Z"), "Asia/Tokyo").toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(nextNineAm(new Date("2026-10-11T23:30:00Z"), "America/New_York").toISOString()).toBe("2026-10-12T13:00:00.000Z");
  });
  it("is still tomorrow just after midnight", () => {
    expect(nextNineAm(new Date("2026-11-03T00:10:00Z"), "Europe/London").toISOString()).toBe("2026-11-04T09:00:00.000Z");
  });
  it("falls back to London for a time zone it doesn't know", () => {
    expect(nextNineAm(new Date("2026-11-03T20:00:00Z"), "Mars/Base").toISOString()).toBe("2026-11-04T09:00:00.000Z");
  });
  it("says the time in plain words", () => {
    expect(whenText(new Date("2026-11-04T09:00:00Z"), "Europe/London")).toBe("Wednesday 4 November at 9am");
    expect(whenText(new Date("2026-11-09T00:11:31Z"), "Europe/London")).toBe("Monday 9 November at 12:11am");
  });
});

describe("when a hold ends on its own", () => {
  const base = { created_at: "2026-10-11T00:11:00Z", amount: "2500", currency: "GBP", status: "needs_approval" } as unknown as Payment;
  it("uses PayPal's expiry when known", () => {
    expect(holdEndsAt({ ...base, paypal_auth_expires_at: "2026-11-09T00:11:31Z" }).toISOString()).toBe("2026-11-09T00:11:31.000Z");
  });
  it("otherwise 29 days after the hold was made", () => {
    expect(holdEndsAt({ ...base, paypal_auth_expires_at: null }).toISOString()).toBe("2026-11-09T00:11:00.000Z");
  });
  it("says plainly that the money goes back and nothing is paid on its own", () => {
    const line = holdEndLine({ ...base, paypal_auth_expires_at: "2026-11-09T00:11:31Z" }, "Gran", "Europe/London");
    expect(line).toBe("If nobody approves by Monday 9 November at 12:11am, PayPal lets the hold go and the £25.00 goes back to Gran. Spotter never pays it on its own.");
  });
});

let db: Db;
let deps: Deps;
let hhId: string;
const reauth = vi.fn<NonNullable<Deps["paypal"]["reauthorizeAuthorization"]>>();
const voidAuth = vi.fn<Deps["paypal"]["voidAuthorization"]>();
const notify = vi.fn<NonNullable<Deps["notify"]>>();

beforeEach(async () => {
  db = await pgliteDb();
  reauth.mockReset().mockResolvedValue({ authorizationId: "A2", expiresAt: "2026-11-09T00:11:31Z" });
  voidAuth.mockReset().mockResolvedValue({ status: "VOIDED" });
  notify.mockReset().mockResolvedValue();
  deps = {
    db,
    check: async () => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false }),
    notify,
    paypal: {
      createAuthorizeOrder: async () => ({ orderId: "O1", authorizationId: "A1", expiresAt: "2026-11-09T00:11:31Z" }),
      captureAuthorization: vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" })),
      voidAuthorization: voidAuth,
      reauthorizeAuthorization: reauth,
    },
  };
  hhId = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
  await createSpender(db, {
    id: "gran",
    householdId: hhId,
    name: "Gran",
    kind: "person",
    spotterName: "Sam",
    allowance: { weekly: gbp(100000), askAbove: gbp(1000), blockedCategories: [], allowedPayees: [], blockedPayees: [] },
  });
});

async function held(): Promise<Payment> {
  const p = await submitPayment(deps, { spenderId: "gran", money: gbp(2500), payee: { name: "Roofer", isNew: true }, category: "home", method: "paypal_order", context: "" });
  expect(p.status).toBe("needs_approval");
  return p;
}
/** Pretends the hold was made `days` ago (PayPal's clock is what counts, so created_at moves too). */
const age = (id: string, days: number) => db.query("update payments set created_at = now() - make_interval(days => $2) where id = $1", [id, days]);

describe("ask again tomorrow", () => {
  it("keeps the hold, never touches PayPal, and sets tomorrow 9am household time", async () => {
    const p = await held();
    const now = new Date();
    const r = await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payment.status).toBe("needs_approval");
    expect(new Date(r.payment.ask_again_at!).toISOString()).toBe(nextNineAm(now, "Europe/London").toISOString());
    expect(reauth).not.toHaveBeenCalled();
    expect(voidAuth).not.toHaveBeenCalled();
    expect((await listEvents(db, p.id)).filter((e) => e.type === "sleeping")).toHaveLength(1);
  });

  it("uses the household's own time zone", async () => {
    await db.query("update households set time_zone = 'America/New_York' where id = $1", [hhId]);
    const p = await held();
    const now = new Date("2026-10-11T23:30:00Z");
    const r = await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now });
    expect(r.ok && new Date(r.payment.ask_again_at!).toISOString()).toBe("2026-10-12T13:00:00.000Z");
  });

  it("is idempotent: a double tap is one sleep, one timeline entry", async () => {
    const p = await held();
    const now = new Date();
    await Promise.all([askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now }), askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now })]);
    const after = (await getPayment(db, p.id))!;
    expect(after.sleeps).toBe(1);
    expect((await listEvents(db, p.id)).filter((e) => e.type === "sleeping")).toHaveLength(1);
  });

  it("only for the household that owns the payment", async () => {
    const p = await held();
    const other = (await createHousehold(db, { name: "O", spotterName: "Eve" })).id;
    const r = await askAgainTomorrow(deps, { id: p.id, householdId: other, by: "Eve" });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect((await getPayment(db, p.id))!.ask_again_at).toBeNull();
  });

  it("only while it is still waiting", async () => {
    const p = await held();
    await approve(deps, p.id, "Sam");
    const r = await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam" });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses when PayPal lets the hold go before tomorrow morning, and says when", async () => {
    const p = await held();
    const now = new Date("2026-11-08T12:00:00Z");
    await db.query("update payments set paypal_auth_expires_at = '2026-11-09T00:11:31Z' where id = $1", [p.id]);
    const r = await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toContain("Monday 9 November at 12:11am");
  });
});

describe("asking again in the morning", () => {
  it("asks the spotter again on the same channels once it's due, once", async () => {
    const p = await held();
    notify.mockClear();
    const now = new Date();
    await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now });
    expect(await askAgainDue(deps, now)).toBe(0); // not yet
    const later = new Date(nextNineAm(now, "Europe/London").getTime() + 60_000);
    const [a, b] = await Promise.all([askAgainDue(deps, later), askAgainDue(deps, later)]);
    expect(a + b).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const sent = notify.mock.calls[0]![0];
    expect(sent.status).toBe("needs_approval");
    expect(sent.sleeps).toBe(1);
    const after = (await getPayment(db, p.id))!;
    expect(after.ask_again_at).toBeNull();
    expect(after.status).toBe("needs_approval");
    expect((await listEvents(db, p.id)).some((e) => e.type === "asked_again")).toBe(true);
  });

  it("doesn't ask about a payment that was decided in the meantime", async () => {
    const p = await held();
    notify.mockClear();
    const now = new Date();
    await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now });
    await approve(deps, p.id, "Sam");
    expect(await askAgainDue(deps, new Date(now.getTime() + 2 * DAY))).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("the morning alert says it is asking again, on every channel", async () => {
    const p = await held();
    const now = new Date();
    await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now });
    await askAgainDue(deps, new Date(now.getTime() + 2 * DAY));
    const [sent, spender] = notify.mock.calls.at(-1)!;
    expect(alertText(sent, spender)).toContain("Asking again, as you wanted: Gran wants to pay £25.00. It's still on hold.");
    expect(alertContent(sent, spender)).toContain("Asking again, as you wanted");
    expect(alertEmail(sent, spender, "https://x").subject).toBe("Asking again: Gran wants to pay £25.00. It's still on hold");
    // The first alert didn't say it.
    expect(alertText(p, spender)).not.toContain("Asking again");
  });

  it("a failed alert is written on the timeline, not lost", async () => {
    const p = await held();
    notify.mockReset().mockRejectedValue(new Error("Telegram down"));
    const now = new Date();
    await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam", now });
    await askAgainDue(deps, new Date(now.getTime() + 2 * DAY));
    expect((await listEvents(db, p.id)).find((e) => e.type === "alert_failed")).toBeTruthy();
  });
});

describe("keeping a sleeping hold alive (reauthorize)", () => {
  async function sleeping(days: number) {
    const p = await held();
    await askAgainTomorrow(deps, { id: p.id, householdId: hhId, by: "Sam" });
    await age(p.id, days);
    return p;
  }

  it("does nothing inside PayPal's three day honor period", async () => {
    await sleeping(2);
    expect(await keepHoldsAlive(deps)).toBe(0);
    expect(reauth).not.toHaveBeenCalled();
  });

  it("reauthorizes once after day 3, with an idempotency key, and switches to the new authorisation", async () => {
    const p = await sleeping(4);
    expect(await keepHoldsAlive(deps)).toBe(1);
    expect(reauth).toHaveBeenCalledWith("A1", `reauth-${p.id}`);
    const after = (await getPayment(db, p.id))!;
    expect(after.paypal_authorization_id).toBe("A2");
    expect(after.reauthorized_at).not.toBeNull();
    expect(after.status).toBe("needs_approval");
    expect((await listEvents(db, p.id)).find((e) => e.type === "reauthorized")?.data).toMatchObject({ from: "A1", to: "A2" });
  });

  it("never twice: PayPal allows one reauthorize per hold", async () => {
    await sleeping(4);
    await keepHoldsAlive(deps);
    await keepHoldsAlive(deps);
    expect(reauth).toHaveBeenCalledTimes(1);
  });

  it("two cron runs at once still call PayPal once", async () => {
    await sleeping(4);
    await Promise.all([keepHoldsAlive(deps), keepHoldsAlive(deps)]);
    expect(reauth).toHaveBeenCalledTimes(1);
  });

  it("not from day 29 on: the hold is about to end, so it is left to end", async () => {
    await sleeping(29);
    expect(await keepHoldsAlive(deps)).toBe(0);
    expect(reauth).not.toHaveBeenCalled();
  });

  it("only for holds someone chose to sleep on", async () => {
    const p = await held();
    await age(p.id, 5);
    expect(await keepHoldsAlive(deps)).toBe(0);
  });

  it("never captures", async () => {
    await sleeping(4);
    await keepHoldsAlive(deps);
    expect(deps.paypal.captureAuthorization).not.toHaveBeenCalled();
  });

  it("a payment source PayPal can't reauthorize is said plainly and not tried again", async () => {
    const p = await sleeping(4);
    reauth.mockRejectedValue(new PayPalError("nope", 422, "REAUTHORIZATION_NOT_SUPPORTED_FOR_PAYMENT_SOURCE"));
    expect(await keepHoldsAlive(deps)).toBe(0);
    await keepHoldsAlive(deps);
    expect(reauth).toHaveBeenCalledTimes(1);
    const after = (await getPayment(db, p.id))!;
    expect(after.paypal_authorization_id).toBe("A1");
    expect(after.status).toBe("needs_approval");
    expect(after.reauth_note).toMatch(/PayPal/);
    expect((await listEvents(db, p.id)).find((e) => e.type === "reauth_failed")?.data).toMatchObject({ issue: "REAUTHORIZATION_NOT_SUPPORTED_FOR_PAYMENT_SOURCE", retry: false });
  });

  it("an outage is tried again on the next run", async () => {
    await sleeping(4);
    reauth.mockRejectedValueOnce(new PayPalError("down", 503));
    await keepHoldsAlive(deps);
    expect(await keepHoldsAlive(deps)).toBe(1);
    expect(reauth).toHaveBeenCalledTimes(2);
  });

  it("if the spotter decided while PayPal was answering, the new hold is let go", async () => {
    const p = await sleeping(4);
    reauth.mockImplementation(async () => {
      await db.query("update payments set status = 'voided' where id = $1", [p.id]);
      return { authorizationId: "A2" };
    });
    expect(await keepHoldsAlive(deps)).toBe(0);
    expect(voidAuth).toHaveBeenCalledWith("A2");
    expect((await getPayment(db, p.id))!.paypal_authorization_id).toBe("A1");
  });
});
