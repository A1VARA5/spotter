import { describe, expect, it } from "vitest";
import { engines, type CheckPayment } from "./checks";

const pay = (over: Partial<CheckPayment> & { id: string }): CheckPayment =>
  ({
    spender_id: "gran",
    status: "needs_approval",
    amount: 25000,
    currency: "GBP",
    created_at: "2026-10-11T10:00:00Z",
    request: { payee: { name: "jamie.k1994@mail.example" } },
    ai: null,
    market: null,
    case_file: null,
    paypal_authorization_id: null,
    ...over,
  }) as CheckPayment;

const names = { gran: "Gran", agent: "Shopping agent" };
const none = { lastEvent: null, demo: true };
const byId = (list: ReturnType<typeof engines>, id: string) => list.find((e) => e.id === id)!;

describe("How Spotter checked it", () => {
  it("one row per engine, in a fixed order, each saying plainly what it does", () => {
    const list = engines([], names, none);
    expect(list.map((e) => e.id)).toEqual(["ai", "kernel", "channel3", "watchtower", "activity", "paypal"]);
    expect(list.map((e) => e.name)).toEqual([
      "Spotter's AI check",
      "Cloud browser",
      "Real shop prices",
      "Watchtower",
      "Activity",
      "PayPal holds and webhooks",
    ]);
    expect(list.map((e) => e.by)).toEqual(["Claude", "KERNEL", "Channel3", "AG Studio", "AG Grid", "PayPal"]);
    for (const e of list) expect(e.does.length).toBeGreaterThan(30);
  });

  it("an honest empty state with a Try scenario when the family hasn't used an engine yet", () => {
    const list = engines([], names, none);
    expect(byId(list, "kernel").example).toBeNull();
    expect(byId(list, "kernel").empty).toMatchObject({ href: "/demo#s-agent-trap" });
    expect(byId(list, "channel3").empty).toMatchObject({ href: "/demo#s-agent-big" });
    expect(byId(list, "ai").empty).toMatchObject({ href: "/demo#s-gran-hi-mum" });
  });

  it("uses the family's latest case for each engine and links straight to it", () => {
    const older = pay({ id: "p_old", created_at: "2026-10-11T08:00:00Z", ai: { ok: true, flags: [{ kind: "pressure", severity: "high", quote: "old one", why: "" }] } as never });
    const newer = pay({ id: "p_new", ai: { ok: true, flags: [{ kind: "pressure", severity: "high", quote: "Please hurry mum x", why: "" }] } as never });
    const ai = byId(engines([older, newer], names, none), "ai").example!;
    expect(ai.href).toBe("/dashboard#pay-p_new");
    expect(ai.text).toContain("Gran");
    expect(ai.text).toContain("£250.00");
    expect(ai.text).toContain('"Please hurry mum x"');
  });

  it("the cloud browser row names the page it opened and what it shows", () => {
    const p = pay({
      id: "p_trap",
      spender_id: "agent",
      amount: 1999,
      request: { payee: { name: "GadgetBarn" } } as never,
      case_file: { page: { url: "https://shop.example/x", finalUrl: "https://shop.example/x", title: "", asks: {}, seen: { hidden: [{}] }, tools: { checked: true, tools: [], total: 2, poisoned: 1 } } } as never,
    });
    const k = byId(engines([p], names, none), "kernel").example!;
    expect(k.text).toContain("shop.example");
    expect(k.text).toContain("Shopping agent");
    expect(k.shows).toEqual(["what a person sees vs what the agent read", "tools the page offers AI agents"]);
    expect(k.href).toBe("/dashboard#pay-p_trap");
  });

  it("the cloud browser row shows KERNEL's own screenshot, and offers a safe look at that page", () => {
    const shot = "data:image/jpeg;base64,AAAA";
    const p = pay({
      id: "p_skillet",
      spender_id: "agent",
      request: { payee: { name: "Panmoor Kitchen" }, context: "Shop page: https://spotter-pay.vercel.app/demo-shop/skillet Cast iron" } as never,
      case_file: { page: { url: "https://spotter-pay.vercel.app/demo-shop/skillet", finalUrl: "https://spotter-pay.vercel.app/demo-shop/skillet", title: "Skillet", asks: {}, screenshot: shot } } as never,
    });
    const k = byId(engines([p], names, none), "kernel").example!;
    expect(k.thumb).toEqual({ src: shot, alt: expect.stringContaining("spotter-pay.vercel.app") });
    expect(k.peek).toEqual({ paymentId: "p_skillet", host: "spotter-pay.vercel.app" });
    // Never a picture that isn't our own JPEG, and no look at a page the payment's message never linked.
    const odd = pay({ ...p, id: "p_odd", request: { payee: { name: "x" }, context: "no link here" } as never, case_file: { page: { ...(p.case_file!.page as object), screenshot: "https://evil.example/x.jpg" } } as never });
    const o = byId(engines([odd], names, none), "kernel").example!;
    expect(o.thumb).toBeUndefined();
    expect(o.peek).toBeUndefined();
  });

  it("the real shop prices row compares the ask with the cheapest real shop", () => {
    const p = pay({ id: "p_ear", spender_id: "agent", amount: 24900, request: { payee: { name: "SoundDepot UK" } } as never, market: { flag: null, offers: 6, item: "earbuds", cheapest: { title: "x", domain: "shop.example", price: 17900, currency: "GBP", url: "" } } as never });
    const c = byId(engines([p], names, none), "channel3").example!;
    expect(c.text).toContain("£249.00");
    expect(c.text).toContain("£179.00");
    expect(c.text).toContain("earbuds");
  });

  it("labels an example case that was checked earlier, not live", () => {
    const p = pay({ id: "p_ex", ai: { ok: true, flags: [] } as never, case_file: { example: true } as never });
    expect(byId(engines([p], names, none), "ai").example!.example).toBe(true);
  });

  it("PayPal: the latest real hold, and the last thing PayPal confirmed", () => {
    const p = pay({ id: "p_hold", paypal_authorization_id: "AUTH123" });
    const row = byId(engines([p], names, { demo: false, lastEvent: { type: "PAYMENT.AUTHORIZATION.VOIDED", paymentId: "p_hold" } }), "paypal").example!;
    expect(row.text).toContain("Gran");
    expect(row.text).toMatch(/cancelled the hold, nothing was paid/);
    expect(row.evidence).toBe("/api/payments/p_hold/evidence");
  });

  it("Watchtower and Activity always link, and say what's on them", () => {
    const list = engines([pay({ id: "a" }), pay({ id: "b" })], names, none);
    expect(byId(list, "watchtower").example).toMatchObject({ href: "/watchtower" });
    expect(byId(list, "watchtower").example!.text).toMatch(/sample month/);
    expect(byId(list, "activity").example).toMatchObject({ href: "/ledger" });
    expect(byId(list, "activity").example!.text).toContain("2 payments");
  });
});
