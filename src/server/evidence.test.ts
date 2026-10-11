import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { approve, createSpender, deny, submitPayment, type Deps } from "@/core/lifecycle";
import { fileReport } from "@/core/network";
import { seal } from "@/core/seal";
import { REPLAY_SEAL } from "@/agents/tools";
import { evidenceResponse } from "./evidence";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });
const allowance = { weekly: gbp(100000), askAbove: gbp(500), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
const KERNEL = "https://prod-iad-x.kernel.sh:8443/browser/replays?jwt=a.b.c&replay_id=r1";
const SHOT = "data:image/jpeg;base64,/9j/AAAA";
const MESSAGE = `Hi Mum, it's me, new number. Can you send £250 now? <script>alert(1)</script> Pay here: https://pay-mum.example/x`;

let db: Db;
let deps: Deps;
let hh: string;
let other: string;
let paymentId: string;
let sealed: string;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

beforeEach(async () => {
  db = await pgliteDb();
  deps = {
    db,
    check: vi.fn(async () => ({
      ok: true as const,
      flags: [{ kind: "impersonation" as const, severity: "high" as const, quote: "it's me, new number", why: "A new number claiming to be family." }],
      dropped: 0,
      hidden: [],
      summary: "Looks like the Hi Mum scam.",
      injectionAttempt: false,
    })),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "5O190127TN364715T", authorizationId: "0VF52814937998046", expiresAt: "2026-11-09T00:11:31Z" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  hh = (await createHousehold(db, { name: "Sam's household", spotterName: "Sam" })).id;
  other = (await createHousehold(db, { name: "Other family", spotterName: "Eve" })).id;
  await createSpender(db, { id: "gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance });
  await createSpender(db, { id: "otherkid", householdId: other, name: "Otherkid", kind: "kid", spotterName: "Eve", allowance });
  paymentId = (await submitPayment(deps, { spenderId: "gran", money: gbp(25000), payee: { name: "New number (Mum)", isNew: true }, category: "family", method: "paypal_order", context: MESSAGE })).id;
  sealed = seal(REPLAY_SEAL, KERNEL);
  const c = {
    status: "done",
    verdict: "likely_scam",
    headline: "This looks like someone pretending to be family.",
    findings: [
      { text: "2 other Spotter families said no to this payee.", tool: "network_reports", source: "c1" },
      { text: "The link goes to pay-mum.example, registered 3 days ago.", tool: "check_links", source: "c2", quote: "https://pay-mum.example/x" },
    ],
    ask: ["Ring her on the number you already have."],
    calls: [{ id: "c2", tool: "check_links", args: { url: "https://secret-arg.example/" }, ok: true, summary: "internal summary text" }],
    dropped: 0,
    model: "claude-test",
    ms: 1,
    page: { url: "https://pay-mum.example/x", finalUrl: "https://pay-mum.example/login", title: "Pay Mum", asks: { card: true, login: false, giftCard: false }, screenshot: SHOT, replay: { sealed, at: new Date().toISOString() } },
  };
  await db.query("update payments set case_file = $2, approve_url = 'https://www.sandbox.paypal.com/checkoutnow?token=APPROVE-SECRET' where id = $1", [paymentId, JSON.stringify(c)]);
  // Another family's data that must never show up.
  await submitPayment(deps, { spenderId: "otherkid", money: gbp(999), payee: { name: "Other family shop", isNew: true }, category: "games", method: "paypal_order", context: "OTHER FAMILY MESSAGE" });
  await fileReport(db, { householdId: other, identifier: "New number (Mum)", kind: "denied" });
});

const get = (format?: string) => evidenceResponse(db, hh, paymentId, format ?? null);

describe("evidence pack: who can get it", () => {
  it("only the household that owns the payment", async () => {
    const r = await evidenceResponse(db, other, paymentId, null);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("New number");
  });

  it("an unknown payment is a 404", async () => {
    expect((await evidenceResponse(db, hh, "pay_nope", null)).status).toBe(404);
  });

  it("not for a payment that simply went through", async () => {
    const paid = await submitPayment(deps, { spenderId: "gran", money: gbp(200), payee: { name: "Corner shop", isNew: true }, category: "food", method: "paypal_order", context: "" });
    const done = paid.status === "needs_approval" ? await approve(deps, paid.id, "Sam") : paid;
    expect(done.status).toBe("captured");
    expect((await evidenceResponse(db, hh, paid.id, null)).status).toBe(409);
  });

  it("works for held, denied and stopped payments", async () => {
    expect((await get()).status).toBe(200);
    await deny(deps, paymentId, "Sam");
    expect((await get()).status).toBe(200);
    await db.query("update payments set status = 'blocked' where id = $1", [paymentId]);
    expect((await get("txt")).status).toBe(200);
  });
});

describe("evidence pack: what it says", () => {
  it("HTML print view: inert, private, printable, with everything in order", async () => {
    const r = await get();
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await r.text();
    expect(html).toContain("£250.00");
    expect(html).toContain("New number (Mum)");
    expect(html).toContain("5O190127TN364715T");
    expect(html).toContain("0VF52814937998046");
    expect(html).toContain("Gran");
    // The forwarded message is shown escaped and marked untrusted.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toMatch(/untrusted/i);
    // What Spotter checked, with quotes.
    expect(html).toContain("it&#39;s me, new number");
    expect(html).toContain("The link goes to pay-mum.example, registered 3 days ago.");
    // The screenshot, embedded (no link anywhere to fetch it from).
    expect(html).toContain(`src="${SHOT}"`);
    // The timeline has times.
    expect(html).toMatch(/\d{1,2}:\d{2}/);
    expect(html.indexOf("Asked to pay")).toBeLessThan(html.indexOf("PayPal put the money on hold"));
  });

  it("other families appear only as a number", async () => {
    const html = await (await get()).text();
    expect(html).toContain("1 other Spotter family said no to this payee in the last 30 days");
    expect(html).not.toContain(other);
    expect(html).not.toContain("Other family");
    expect(html).not.toContain("OTHER FAMILY MESSAGE");
    expect(html).not.toContain("Otherkid");
  });

  it("never leaks sealed links, KERNEL links, internal tool calls, the approve link or secrets", async () => {
    for (const body of [await (await get()).text(), await (await get("txt")).text()]) {
      expect(body).not.toContain(sealed);
      expect(body).not.toContain("kernel.sh");
      expect(body).not.toContain("jwt=");
      expect(body).not.toContain("secret-arg.example");
      expect(body).not.toContain("internal summary text");
      expect(body).not.toContain("APPROVE-SECRET");
      expect(body).not.toContain(process.env.SESSION_SECRET!);
      expect(body).not.toContain(hh);
      expect(body).not.toContain("claude-test");
    }
  });

  it("text fallback: a download, plain, with the same facts and the message marked untrusted", async () => {
    const r = await get("txt");
    expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="spotter-evidence-pay_[a-z0-9]+\.txt"$/);
    const t = await r.text();
    expect(t).toContain("£250.00");
    expect(t).toContain("5O190127TN364715T");
    expect(t).toMatch(/UNTRUSTED/);
    expect(t).toContain(MESSAGE);
    expect(t).toContain("Screenshot: included in the printable version");
  });

  it("a denied payment's pack says the spotter said no and PayPal released the money", async () => {
    await deny(deps, paymentId, "Sam");
    const t = await (await get("txt")).text();
    expect(t).toMatch(/Sam said no/);
    expect(t).toMatch(/PayPal released the hold/);
  });
});
