import { describe, expect, it, vi } from "vitest";
import { extractPayment } from "./extract";

const hiMum = "Hi Mum it's me, new number. Can you send £400 to my mate's PayPal, Friends and Family please, it's urgent x";

describe("extractPayment", () => {
  it("reads the amount, payee and method, with the amount quoted from the email", async () => {
    const model = vi.fn(async () => ({
      found: true,
      amount_quote: "£400",
      currency: "GBP",
      payee: "my mate's PayPal",
      method: "friends_and_family",
      category: "family",
      item: null,
    }));
    const r = await extractPayment(hiMum, model);
    expect(r).toMatchObject({ ok: true, found: true, amountPence: 40000, currency: "GBP", method: "friends_and_family", payee: "my mate's PayPal" });
    expect((model.mock.calls as unknown as [{ user: string }][])[0]![0].user).toContain("<email>");
  });

  it("never invents an amount the email doesn't contain", async () => {
    const model = vi.fn(async () => ({ found: true, amount_quote: "£4,000", currency: "GBP", payee: "x", method: "bank_transfer", category: "other", item: null }));
    const r = await extractPayment(hiMum, model);
    expect(r).toMatchObject({ ok: true, found: false });
  });

  it("parses amounts with commas and pence", async () => {
    const model = vi.fn(async () => ({ found: true, amount_quote: "£1,249.50", currency: "GBP", payee: "Shop", method: "paypal_order", category: "electronics", item: "TV" }));
    const r = await extractPayment("Total due: £1,249.50 today", model);
    expect(r).toMatchObject({ amountPence: 124950 });
  });

  it("says when there is no payment in it", async () => {
    const model = vi.fn(async () => ({ found: false, amount_quote: null, currency: null, payee: null, method: null, category: null, item: null }));
    expect(await extractPayment("Lunch on Sunday?", model)).toEqual({ ok: true, found: false });
  });

  it("fails honestly when the model fails", async () => {
    const model = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(await extractPayment(hiMum, model)).toMatchObject({ ok: false });
  });
});
