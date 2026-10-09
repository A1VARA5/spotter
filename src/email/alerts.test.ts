import { describe, expect, it } from "vitest";
import { alertEmail } from "./alerts";
import type { Payment, Spender } from "@/core/lifecycle";

const spender = { id: "sp_1", household_id: "hh_1", name: "Gran", kind: "person", spotter_name: "Sam", email: null, telegram_chat_id: null, allowance: {} } as unknown as Spender;

const payment = (over: Partial<Payment> = {}): Payment =>
  ({
    id: "pay_1",
    spender_id: "sp_1",
    status: "needs_approval",
    amount: 25000,
    currency: "GBP",
    request: {
      payee: { name: "jamie.k1994@gmail.com", isNew: true },
      context: "Can you send £250 to my mate Jamie's PayPal <script>alert(1)</script> please hurry",
      method: "paypal_order",
      category: "family",
    },
    decision: { outcome: "ask", reasons: ["Over the £50.00 \"ask me first\" limit.", "First time paying jamie.k1994@gmail.com."] },
    ai: { ok: true, flags: [{ kind: "pressure", severity: "medium", quote: "please hurry", why: "Rushing her." }], dropped: 0, hidden: [], summary: "Looks like the Hi Mum scam.", injectionAttempt: false },
    market: null,
    ...over,
  }) as unknown as Payment;

describe("alert email", () => {
  it("leads with who, how much and to whom, and links to decide", () => {
    const e = alertEmail(payment(), spender, "https://spotter.test");
    expect(e.subject).toBe("Gran wants to pay £250.00. It's on hold");
    expect(e.html).toContain("£250.00");
    expect(e.html).toContain("jamie.k1994@gmail.com");
    expect(e.html).toContain('href="https://spotter.test/dashboard"');
    expect(e.text).toContain("https://spotter.test/dashboard");
  });

  it("quotes the evidence with the warning words marked", () => {
    const e = alertEmail(payment(), spender, "https://spotter.test");
    expect(e.html).toMatch(/<span[^>]*>please hurry<\/span>/);
    expect(e.html).toContain("Looks like the Hi Mum scam.");
  });

  it("never lets message text become HTML", () => {
    const e = alertEmail(payment(), spender, "https://spotter.test");
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
  });

  it("says stopped payments were stopped, with no approve button", () => {
    const e = alertEmail(payment({ status: "protected" }), spender, "https://spotter.test");
    expect(e.subject).toBe("Spotter stopped £250.00 from Gran");
    expect(e.html).not.toMatch(/Review and decide/);
  });
});
