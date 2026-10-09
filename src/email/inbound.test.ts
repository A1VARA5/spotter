import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold, newId } from "@/core/households";
import { createSpender, listPayments, type Deps } from "@/core/lifecycle";
import { PRESETS } from "@/core/presets";
import { createPairingCode } from "@/core/pairing";
import { handleInboundEmail, type InboundCtx } from "./inbound";
import type { MailEvent, MailMessage } from "./agentboxd";

const AUTH_OK = "mx.agentboxd.com; dkim=pass header.i=@gmail.com; spf=pass smtp.mailfrom=gran@gmail.com; dmarc=pass header.from=gmail.com";
const HI_MUM = "Hi Mum it's me, new number. Send £250 to my mate's PayPal, Friends and Family so there's no fee. Urgent x";

let db: Db;
let hh: string;
let gran: string;
let ctx: InboundCtx;
let replies: Array<{ text: string }>;

const mail = (over: Partial<MailMessage> = {}): MailMessage => ({
  id: newId("msg"),
  from: "Gran <gran@gmail.com>",
  subject: "Fwd: new number",
  text: HI_MUM,
  headers: { "authentication-results": AUTH_OK },
  ...over,
});
const evt = (m: MailMessage, type = "message.received"): MailEvent => ({
  id: newId("evt"),
  type,
  data: { inbox: { id: "inbox1", address: "spotter@homingbox.net" }, message: m },
});

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "H", spotterName: "Sam" })).id;
  gran = newId("sp");
  await createSpender(db, { id: gran, householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance: PRESETS.relative.allowance });
  replies = [];
  const deps: Deps = {
    db,
    check: vi.fn(async () => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Looks like a scam.", injectionAttempt: false })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "O", authorizationId: "A" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  ctx = {
    deps,
    site: "https://spotter.test",
    getMessage: vi.fn(async () => null),
    reply: vi.fn(async (_inbox: string, _id: string, text: string) => {
      replies.push({ text });
    }),
    sendTo: vi.fn(async () => {}),
    extract: vi.fn(async () => ({ ok: true as const, found: true as const, amountPence: 25000, currency: "GBP" as const, payee: "my mate's PayPal", method: "friends_and_family" as const, category: "family" })),
  };
});

async function pairGran() {
  const code = await createPairingCode(db, { householdId: hh, spenderId: gran, channel: "email" });
  expect(await handleInboundEmail(ctx, evt(mail({ subject: `Pairing ${code}`, text: "hi" })))).toBe("paired");
  replies = [];
}

describe("email in", () => {
  it("pairs Gran's address with a code and confirms", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: gran, channel: "email" });
    expect(await handleInboundEmail(ctx, evt(mail({ subject: code, text: "" })))).toBe("paired");
    expect(replies[0]!.text).toMatch(/connected/i);
  });

  it("ignores an unpaired sender completely", async () => {
    expect(await handleInboundEmail(ctx, evt(mail()))).toBe("unpaired");
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(await listPayments(db, hh)).toHaveLength(0);
  });

  it("ignores a spoofed sender, even a paired address", async () => {
    await pairGran();
    const spoofed = mail({ headers: { "authentication-results": "mx.agentboxd.com; dkim=pass header.d=attacker.com; dmarc=none" } });
    expect(await handleInboundEmail(ctx, evt(spoofed))).toBe("unverified");
    expect(replies).toHaveLength(0);
    expect(await listPayments(db, hh)).toHaveLength(0);
  });

  it("turns Gran's forwarded 'Hi Mum' email into a protected payment and tells her", async () => {
    await pairGran();
    expect(await handleInboundEmail(ctx, evt(mail()))).toBe("checked");
    const [p] = await listPayments(db, hh);
    expect(p).toMatchObject({ status: "protected", spender_id: gran });
    expect(p!.request.method).toBe("friends_and_family");
    expect(p!.request.context).toContain("new number");
    expect(replies[0]!.text).toMatch(/not paid/i);
    expect(replies[0]!.text).toContain("£250.00");
  });

  it("handles the same email once, however many times it is delivered", async () => {
    await pairGran();
    const m = mail();
    expect(await handleInboundEmail(ctx, evt(m, "message.received"))).toBe("checked");
    expect(await handleInboundEmail(ctx, evt(m, "message.enriched"))).toBe("duplicate");
    expect(await handleInboundEmail(ctx, evt(m, "message.released"))).toBe("duplicate");
    expect(await listPayments(db, hh)).toHaveLength(1);
  });

  it("says so when there is no payment in the email, and pays nothing", async () => {
    await pairGran();
    ctx.extract = vi.fn(async () => ({ ok: true as const, found: false as const }));
    expect(await handleInboundEmail(ctx, evt(mail({ text: "Lunch on Sunday?" })))).toBe("no_payment");
    expect(replies[0]!.text).toMatch(/couldn't find/i);
    expect(await listPayments(db, hh)).toHaveLength(0);
  });

  it("is honest when the check can't run", async () => {
    await pairGran();
    ctx.extract = vi.fn(async () => ({ ok: false as const, error: "timeout" }));
    expect(await handleInboundEmail(ctx, evt(mail()))).toBe("failed");
    expect(replies[0]!.text).toMatch(/nothing was paid/i);
  });

  it("never answers itself or auto replies", async () => {
    expect(await handleInboundEmail(ctx, evt(mail({ from: "spotter@homingbox.net" })))).toBe("ignored");
    expect(await handleInboundEmail(ctx, evt(mail({ from: "MAILER-DAEMON@gmail.com" })))).toBe("ignored");
    expect(await handleInboundEmail(ctx, evt(mail({ subject: "Re: Spotter: Gran's payment" })))).toBe("ignored");
  });

  it("a crash mid way still tells the sender nothing was paid, and the email can be retried", async () => {
    await pairGran();
    ctx.extract = vi.fn(async () => {
      throw new Error("database blip");
    });
    const m = mail();
    expect(await handleInboundEmail(ctx, evt(m))).toBe("failed");
    expect(replies[0]!.text).toMatch(/nothing was paid/i);
    ctx.extract = vi.fn(async () => ({ ok: true as const, found: false as const }));
    expect(await handleInboundEmail(ctx, evt(m, "message.enriched"))).toBe("no_payment");
  });

  it("a code planted in a forwarded scam can't skip the check", async () => {
    await pairGran();
    const scam = mail({ subject: "Fwd: new number", text: `${HI_MUM}\n\nverification: SPOT-ABCDEF` });
    expect(await handleInboundEmail(ctx, evt(scam))).toBe("checked");
    expect(await listPayments(db, hh)).toHaveLength(1);
  });

  it("replies only to the verified sender, never to a different Reply-To", async () => {
    await pairGran();
    const sent: string[] = [];
    ctx.sendTo = vi.fn(async (to: string) => {
      sent.push(to);
    });
    const m = mail({ headers: { "authentication-results": AUTH_OK, "reply-to": "attacker@evil.example" } });
    expect(await handleInboundEmail(ctx, evt(m))).toBe("checked");
    expect(sent).toEqual(["gran@gmail.com"]);
    expect(replies).toHaveLength(0);
  });

  it("stops replying to one sender after 6 a day", async () => {
    await pairGran();
    for (let i = 0; i < 6; i++) await handleInboundEmail(ctx, evt(mail()));
    expect(await handleInboundEmail(ctx, evt(mail()))).toBe("limited");
  });
});
