import { describe, expect, it } from "vitest";
import { peekableHost } from "./peekable";

const p = (url: string | undefined, context: string | null, finalUrl?: string) => ({ case_file: url ? { page: { url, finalUrl } } : null, request: { context } });

describe("which page can be looked at again safely", () => {
  it("offers a page that is a link from the payment's own message, named by where it ended up", () => {
    expect(peekableHost(p("https://spotter-pay.vercel.app/demo-shop/skillet", "Shop page: https://spotter-pay.vercel.app/demo-shop/skillet Cast iron skillet"))).toBe("spotter-pay.vercel.app");
    expect(peekableHost(p("https://parcels.example/t/", "Pay at parcels.example/t now", "https://collect-x.example/pay"))).toBe("collect-x.example");
  });

  it("offers nothing without a page, without a message, or for a page the message never linked", () => {
    expect(peekableHost(p(undefined, "x"))).toBeNull();
    expect(peekableHost(p("https://a.example/", null))).toBeNull();
    expect(peekableHost(p("https://other.example/x", "Pay at parcels.example/t now"))).toBeNull();
    expect(peekableHost(p("javascript:alert(1)", "javascript:alert(1)"))).toBeNull();
  });
});
