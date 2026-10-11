import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "./households";
import { createSpender, getPayment, listEvents, submitPayment, deny, approve, type Deps, type Payment, type Spender } from "./lifecycle";
import type { AiCheckResult } from "@/ai/check";
import {
  answerWasItYou,
  claimFromText,
  groundClaim,
  matchClaim,
  planWasItYou,
  tokenFor,
  type Claim,
  type WasItYou,
} from "./was-it-you";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(5000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const HI_TOM = "Hi Mum it's Tom, new number. Phone broke and I can't get into my banking. Can you send £250 to my mate Jamie's account today? x";

describe("claimFromText (code's own fallback)", () => {
  it("finds a name the message gives, with the exact words", () => {
    expect(claimFromText(HI_TOM)).toEqual({ name: "Tom", relation: "child", quote: "it's Tom" });
    expect(claimFromText("Tom here, lost my phone")).toMatchObject({ name: "Tom", quote: "Tom here" });
    expect(claimFromText("hey its Priya, can u help")).toMatchObject({ name: "Priya" });
  });

  it("finds a relation when there is no name", () => {
    expect(claimFromText("Hi mum its me, new number")).toEqual({ name: null, relation: "child", quote: "Hi mum its me" });
    expect(claimFromText("Dad it's me, I'm stuck")).toMatchObject({ relation: "child" });
    expect(claimFromText("This is your son, I need help")).toMatchObject({ relation: "child", quote: "your son" });
    expect(claimFromText("Gran it's me, your grandson")).toMatchObject({ relation: "grandchild" });
  });

  it("ignores ordinary words that look like names, and plain shop text", () => {
    expect(claimFromText("It's Tuesday so the shop is shut")).toBeNull();
    expect(claimFromText("Handmade stoneware mug, 350ml. £24.99.")).toBeNull();
    expect(claimFromText("It's Me again")).toBeNull();
    expect(claimFromText("")).toBeNull();
  });
});

describe("groundClaim", () => {
  it("keeps a claim only when the quote is really in the message and the name is too", () => {
    expect(groundClaim({ name: "Tom", relation: "child", quote: "it's Tom" }, HI_TOM)).toEqual({ name: "Tom", relation: "child", quote: "it's Tom" });
    expect(groundClaim({ name: "Tom", relation: null, quote: "this is Tom from work" }, HI_TOM)).toBeNull();
    expect(groundClaim({ name: "Sam", relation: null, quote: "Hi Mum" }, HI_TOM)).toBeNull();
    expect(groundClaim({ name: null, relation: "child", quote: "" }, HI_TOM)).toBeNull();
    // A long "quote" is refused even when real: it is shown to the person asked.
    expect(groundClaim({ name: "Tom", relation: null, quote: HI_TOM }, HI_TOM)).toBeNull();
  });
});

describe("matchClaim", () => {
  const household = { id: "hh", spotter_name: "Sam" };
  const sp = (id: string, name: string, kind: Spender["kind"] = "person") => ({ id, name, kind }) as Spender;
  const gran = sp("gran", "Gran");
  const people = [gran, sp("tom", "Tom Baker"), sp("leo", "Leo", "kid"), sp("agent", "Shopping agent", "agent")];
  const claim = (c: Partial<Claim>): Claim => ({ name: null, relation: null, quote: "x", ...c });

  it("a name that's nobody in the family: no ask", () => {
    expect(matchClaim(claim({ name: "Kevin" }), { household, spenders: people, payer: gran })).toBeNull();
    // A name wins over a relation: "it's Kevin, your son" is not the spotter.
    expect(matchClaim(claim({ name: "Kevin", relation: "child" }), { household, spenders: people, payer: gran })).toBeNull();
  });

  it("a person in the family, by first name", () => {
    expect(matchClaim(claim({ name: "tom" }), { household, spenders: people, payer: gran })).toEqual({ kind: "spender", spenderId: "tom", name: "Tom Baker" });
    expect(matchClaim(claim({ name: "Leo" }), { household, spenders: people, payer: gran })).toEqual({ kind: "spender", spenderId: "leo", name: "Leo" });
  });

  it("the spotter by name, or by role when the message calls Gran Mum", () => {
    expect(matchClaim(claim({ name: "Sam" }), { household, spenders: people, payer: gran })).toEqual({ kind: "spotter", name: "Sam" });
    expect(matchClaim(claim({ relation: "child" }), { household, spenders: people, payer: gran })).toEqual({ kind: "spotter", name: "Sam" });
  });

  it("is conservative: two people with the name, the payer themselves, agents, a kid's 'Mum it's me', grandchildren without a name", () => {
    const twoToms = [...people, sp("tom2", "Tom")];
    expect(matchClaim(claim({ name: "Tom" }), { household, spenders: twoToms, payer: gran })).toBeNull();
    expect(matchClaim(claim({ name: "Gran" }), { household, spenders: people, payer: gran })).toBeNull();
    expect(matchClaim(claim({ name: "Shopping" }), { household, spenders: people, payer: gran })).toBeNull();
    const leo = people[2]!;
    expect(matchClaim(claim({ relation: "child" }), { household, spenders: people, payer: leo })).toBeNull();
    expect(matchClaim(claim({ relation: "grandchild" }), { household, spenders: people, payer: gran })).toBeNull();
    // A name that is also the spotter's and a person's: ambiguous.
    expect(matchClaim(claim({ name: "Sam" }), { household, spenders: [...people, sp("sam2", "Sam")], payer: gran })).toBeNull();
  });
});

describe("asking the real person, and their answer", () => {
  let db: Db;
  let deps: Deps;
  let hh: string;
  let ask: ReturnType<typeof vi.fn>;
  let note: ReturnType<typeof vi.fn>;
  let decided: ReturnType<typeof vi.fn>;
  const voidAuth = vi.fn(async () => ({ status: "VOIDED" }));
  const capture = vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" }));
  const held: AiCheckResult = {
    ok: true,
    flags: [{ kind: "impersonation", severity: "high", quote: "it's Tom, new number", why: "New number, says family." }],
    dropped: 0,
    hidden: [],
    summary: "Looks like the Hi Mum scam.",
    injectionAttempt: false,
    claimedSender: { name: "Tom", relation: "child", quote: "it's Tom" },
  };

  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
    db = await pgliteDb();
    voidAuth.mockClear();
    capture.mockClear();
    ask = vi.fn(async () => {});
    note = vi.fn(async () => {});
    decided = vi.fn(async () => {});
    deps = {
      db,
      check: vi.fn(async () => held),
      ask,
      note,
      decided,
      paypal: {
        createAuthorizeOrder: vi.fn(async () => ({ orderId: "O1", authorizationId: "A1", expiresAt: "2026-11-07T00:00:00Z" })),
        captureAuthorization: capture,
        voidAuthorization: voidAuth,
      },
    } as unknown as Deps;
    hh = (await createHousehold(db, { name: "Ours", spotterName: "Sam" })).id;
    await createSpender(db, { id: "gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance });
    await createSpender(db, { id: "tom", householdId: hh, name: "Tom", kind: "person", spotterName: "Sam", allowance });
    await db.query("update spenders set telegram_chat_id = '777' where id = 'tom'");
    await db.query("update spenders set telegram_chat_id = '111' where id = 'gran'");
  });

  const send = (context = HI_TOM) =>
    submitPayment(deps, { spenderId: "gran", money: gbp(25000), payee: { name: "jamie@mail.example", isNew: true }, category: "family", method: "paypal_order", context });

  const wiy = async (id: string) => (await getPayment(db, id))!.was_it_you as WasItYou;

  it("asks Tom on his own linked channel, once, and the case file says so", async () => {
    const p = await send();
    expect(p.status).toBe("needs_approval");
    const w = await wiy(p.id);
    expect(w).toMatchObject({ state: "asked", who: "Tom", channel: "telegram", target: { kind: "spender", spenderId: "tom" }, claim: { quote: "it's Tom" } });
    expect(ask).toHaveBeenCalledTimes(1);
    const [, payer, asked, target] = ask.mock.calls[0]!;
    expect(payer.name).toBe("Gran");
    expect(asked.id).toBe(w.id);
    expect(target).toMatchObject({ telegram_chat_id: "777" });
    expect((await listEvents(db, p.id)).map((e) => e.type)).toContain("was_it_you_asked");
  });

  it("a message naming a stranger asks nobody", async () => {
    deps.check = vi.fn(async () => ({ ...held, claimedSender: { name: "Kevin", relation: null, quote: "it's Kevin" } }));
    const p = await send(HI_TOM.replace("Tom", "Kevin"));
    expect((await getPayment(db, p.id))!.was_it_you).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it("a message naming the spotter is merged into the spotter's alert: no second message", async () => {
    deps.check = vi.fn(async () => ({ ...held, claimedSender: { name: "Sam", relation: null, quote: "it's Sam" } }));
    const p = await send(HI_TOM.replace("Tom", "Sam"));
    expect(await wiy(p.id)).toMatchObject({ state: "asked", who: "Sam", channel: "alert", target: { kind: "spotter" } });
    expect(ask).not.toHaveBeenCalled();
  });

  it("when Tom has no linked channel, nobody is invented: the spotter is told instead", async () => {
    await db.query("update spenders set telegram_chat_id = null where id = 'tom'");
    const notify = vi.fn(async (_p: Payment, _s: Spender) => {});
    deps.notify = notify;
    const p = await send();
    expect(await wiy(p.id)).toMatchObject({ state: "no_channel", who: "Tom", channel: null });
    expect(ask).not.toHaveBeenCalled();
    // The spotter's alert carries the state, so it can say "ring Tom yourself".
    expect(notify.mock.calls[0]![0].was_it_you).toMatchObject({ state: "no_channel" });
  });

  it("a failed send is recorded, not hidden", async () => {
    ask.mockRejectedValueOnce(new Error("telegram 403"));
    const p = await send();
    expect(await wiy(p.id)).toMatchObject({ state: "send_failed" });
    expect((await listEvents(db, p.id)).map((e) => e.type)).toContain("was_it_you_failed");
  });

  it("only held payments get an ask", async () => {
    // A gift card is stopped outright: there is no hold to release, so nobody is asked.
    const p = await submitPayment(deps, { spenderId: "gran", money: gbp(1000), payee: { name: "Codes", isNew: true }, category: "gift_cards", method: "gift_card", context: HI_TOM });
    expect(p.status).not.toBe("needs_approval");
    expect((await getPayment(db, p.id))!.was_it_you).toBeNull();
  });

  it("'Not me' from Tom's chat voids the hold at once, tells Gran in plain words and tells the spotter", async () => {
    const p = await send();
    const token = tokenFor(await wiy(p.id), p.id);
    const r = await answerWasItYou(deps, { token, answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(r.ok).toBe(true);
    expect(r.reply).toMatch(/£250\.00 is safe/);
    const after = (await getPayment(db, p.id))!;
    expect(after.status).toBe("voided");
    expect(voidAuth).toHaveBeenCalledTimes(1);
    expect(after.was_it_you).toMatchObject({ state: "not_me" });
    expect(decided).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledTimes(1);
    expect(note.mock.calls[0]![2]).toMatch(/Tom says .*didn't send/);
    expect((await listEvents(db, p.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["was_it_you_answered", "denied", "voided"]));
  });

  it("refuses a forged token, a replayed one, a token for another payment and the wrong chat", async () => {
    const a = await send();
    const b = await send();
    const wa = await wiy(a.id);
    const wb = await wiy(b.id);
    const good = tokenFor(wa, a.id);

    // Forged signature.
    const forged = `${wa.id}.${"A".repeat(22)}`;
    expect((await answerWasItYou(deps, { token: forged, answer: "not_me", as: { channel: "telegram", id: "777" } })).ok).toBe(false);
    // A real signature made for payment B, pasted onto A's check.
    const mixed = `${wa.id}.${tokenFor(wb, b.id).split(".")[1]}`;
    expect((await answerWasItYou(deps, { token: mixed, answer: "not_me", as: { channel: "telegram", id: "777" } })).ok).toBe(false);
    // Signed for the right check but claims a different payment id: still A's row, so the signature doesn't fit.
    expect((await answerWasItYou(deps, { token: tokenFor(wa, b.id), answer: "not_me", as: { channel: "telegram", id: "777" } })).ok).toBe(false);
    // Gran's own chat, or the spotter's, can't answer for Tom.
    expect((await answerWasItYou(deps, { token: good, answer: "not_me", as: { channel: "telegram", id: "111" } })).ok).toBe(false);
    // Token alone (an email link) can't answer an ask that went to Telegram.
    expect((await answerWasItYou(deps, { token: good, answer: "not_me", as: { channel: "link" } })).ok).toBe(false);
    expect(voidAuth).not.toHaveBeenCalled();

    expect((await answerWasItYou(deps, { token: good, answer: "not_me", as: { channel: "telegram", id: "777" } })).ok).toBe(true);
    const replay = await answerWasItYou(deps, { token: good, answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(replay.ok).toBe(false);
    expect(replay.reply).toMatch(/already/i);
    expect(voidAuth).toHaveBeenCalledTimes(1);
    expect((await getPayment(db, b.id))!.status).toBe("needs_approval");
  });

  it("'Yes, it's me' never pays: it records the answer and the spotter still needs the PIN", async () => {
    const p = await send();
    const r = await answerWasItYou(deps, { token: tokenFor(await wiy(p.id), p.id), answer: "it_was_me", as: { channel: "telegram", id: "777" } });
    expect(r.ok).toBe(true);
    expect(r.reply).toMatch(/PIN/);
    const after = (await getPayment(db, p.id))!;
    expect(after.status).toBe("needs_approval");
    expect(after.was_it_you).toMatchObject({ state: "it_was_me" });
    expect(capture).not.toHaveBeenCalled();
    expect(voidAuth).not.toHaveBeenCalled();
    expect(note.mock.calls[0]![2]).toMatch(/PIN/);
  });

  it("says what really happened when the payment was already decided in another tab", async () => {
    const denied = await send();
    await deny(deps, denied.id, "Sam");
    const r1 = await answerWasItYou(deps, { token: tokenFor(await wiy(denied.id), denied.id), answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(r1.reply).toMatch(/already stopped/i);
    expect(voidAuth).toHaveBeenCalledTimes(1);

    const paid = await send();
    await approve(deps, paid.id, "Sam");
    const r2 = await answerWasItYou(deps, { token: tokenFor(await wiy(paid.id), paid.id), answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(r2.reply).toMatch(/already approved/i);
    expect((await getPayment(db, paid.id))!.status).toBe("captured");
    // The spotter hears about it straight away: money went to someone Tom says isn't him.
    expect(note.mock.calls.at(-1)![2]).toMatch(/paid/);
  });

  it("an expired question changes nothing", async () => {
    const p = await send();
    await db.query("update payments set was_it_you = jsonb_set(was_it_you, '{expiresAt}', to_jsonb((now() - interval '1 minute')::text)) where id = $1", [p.id]);
    const r = await answerWasItYou(deps, { token: tokenFor(await wiy(p.id), p.id), answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(r.ok).toBe(false);
    expect(r.reply).toMatch(/expired/i);
    expect(voidAuth).not.toHaveBeenCalled();
  });

  it("the spotter answers a merged ask from their own chat", async () => {
    await db.query("update households set telegram_chat_id = '999' where id = $1", [hh]);
    deps.check = vi.fn(async () => ({ ...held, claimedSender: { name: "Sam", relation: null, quote: "it's Sam" } }));
    const p = await send(HI_TOM.replace("Tom", "Sam"));
    const token = tokenFor(await wiy(p.id), p.id);
    expect((await answerWasItYou(deps, { token, answer: "not_me", as: { channel: "telegram", id: "777" } })).ok).toBe(false);
    expect((await answerWasItYou(deps, { token, answer: "not_me", as: { channel: "telegram", id: "999" } })).ok).toBe(true);
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    // The spotter did it themselves, so no extra note to them.
    expect(note).not.toHaveBeenCalled();
  });

  it("a failed PayPal void never says the money is safe, and says when the spotter couldn't be reached", async () => {
    const p = await send();
    voidAuth.mockRejectedValueOnce(new Error("PayPal 500"));
    const r = await answerWasItYou(deps, { token: tokenFor(await wiy(p.id), p.id), answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(r.reply).not.toMatch(/is safe/);
    expect(r.reply).toMatch(/didn't confirm releasing/);
    // The note stub delivered nowhere, so the reply doesn't claim the spotter knows.
    expect(r.reply).toMatch(/couldn't reach Sam/);
    expect((await getPayment(db, p.id))!.status).toBe("voiding"); // reconcile keeps asking PayPal to let it go
  });

  it("says the spotter was told only when a note really went out", async () => {
    const paid = await send();
    await approve(deps, paid.id, "Sam");
    note.mockResolvedValue(true);
    const r = await answerWasItYou(deps, { token: tokenFor(await wiy(paid.id), paid.id), answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(r.reply).toMatch(/Sam has been told/);
  });

  it("a crash after the answer is saved reopens the question, so pressing again really retries", async () => {
    const p = await send();
    const token = tokenFor(await wiy(p.id), p.id);
    const realDeny = deps.paypal.voidAuthorization;
    deps.decided = vi.fn(async () => {});
    // Break the database just for the payer lookup that follows the saved answer.
    const query = db.query.bind(db);
    let broken = true;
    db.query = (async (sql: string, params?: unknown[]) => {
      if (broken && sql.startsWith("select * from spenders where id")) {
        broken = false;
        throw new Error("db hiccup");
      }
      return query(sql, params);
    }) as typeof db.query;
    const first = await answerWasItYou(deps, { token, answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(first.ok).toBe(false);
    expect(first.reply).toMatch(/still on hold. Press the button again/);
    expect((await wiy(p.id)).state).toBe("asked");
    const second = await answerWasItYou(deps, { token, answer: "not_me", as: { channel: "telegram", id: "777" } });
    expect(second.ok).toBe(true);
    expect((await getPayment(db, p.id))!.status).toBe("voided");
    expect(realDeny).toHaveBeenCalledTimes(1);
  });

  it("planWasItYou leaves agents alone", async () => {
    await createSpender(db, { id: "agent", householdId: hh, name: "Agent", kind: "agent", spotterName: "Sam", allowance });
    const p = await submitPayment(deps, { spenderId: "agent", money: gbp(25000), payee: { name: "Shop", isNew: true }, category: "x", method: "paypal_order", context: HI_TOM });
    expect((await getPayment(db, p.id))!.was_it_you).toBeNull();
    const again = await planWasItYou(db, (await getPayment(db, p.id))!, { id: "agent", kind: "agent" } as Spender);
    expect(again).toBeNull();
  });
});
