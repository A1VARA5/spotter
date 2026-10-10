import { describe, expect, it, vi } from "vitest";
import { visitInCloud, type KernelLike } from "./kernel";

const smallShot = Buffer.alloc(2000, 1).toString("base64");

function fakeKernel(execute: KernelLike["browsers"]["playwright"]["execute"]) {
  const client = {
    browsers: {
      create: vi.fn(async () => ({ session_id: "sess1" })),
      deleteByID: vi.fn(async () => {}),
      playwright: { execute: vi.fn(execute) },
    },
  };
  return client;
}

const good = {
  success: true,
  result: {
    finalUrl: "https://bargainpods.shop/checkout",
    title: "Checkout",
    facts: { password: false, card: true, login: false, giftCard: true, forms: 1 },
    shot: smallShot,
  },
};

describe("visitInCloud", () => {
  it("opens the page once, returns plain facts and a small screenshot, and deletes the browser", async () => {
    const k = fakeKernel(async () => good);
    const v = await visitInCloud("https://bargainpods.shop/airpods", { client: k });
    expect(v).toMatchObject({
      ok: true,
      url: "https://bargainpods.shop/airpods",
      finalUrl: "https://bargainpods.shop/checkout",
      title: "Checkout",
      asks: { card: true, login: false, giftCard: true },
    });
    expect(v.ok && v.screenshot).toBe(`data:image/jpeg;base64,${smallShot}`);
    expect(k.browsers.create).toHaveBeenCalledTimes(1);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess1");
  });

  it("only reads the page: no typing, clicking or submitting in the code it runs", async () => {
    const k = fakeKernel(async () => good);
    await visitInCloud("https://bargainpods.shop/airpods", { client: k });
    const { code } = k.browsers.playwright.execute.mock.calls[0]![1];
    expect(code).toContain("page.goto(");
    expect(code).not.toMatch(/\.(fill|type|click|press|check|selectOption|setInputFiles|tap)\(|submit|keyboard|mouse/);
  });

  it("passes the URL as a quoted string, so a crafted URL can't become code", async () => {
    const k = fakeKernel(async () => good);
    await visitInCloud('https://evil.example/"+process.exit()+"', { client: k });
    const { code } = k.browsers.playwright.execute.mock.calls[0]![1];
    expect(code).not.toContain('"+process.exit()+"');
  });

  it("drops a screenshot over about 60 KB", async () => {
    const big = Buffer.alloc(70_000, 1).toString("base64");
    const k = fakeKernel(async () => ({ ...good, result: { ...good.result, shot: big } }));
    const v = await visitInCloud("https://bargainpods.shop/", { client: k });
    expect(v.ok).toBe(true);
    expect(v.ok && v.screenshot).toBeUndefined();
  });

  it("still deletes the browser when the page fails", async () => {
    const k = fakeKernel(async () => ({ success: false, error: "net::ERR_NAME_NOT_RESOLVED" }));
    const v = await visitInCloud("https://nope.invalid/", { client: k });
    expect(v).toMatchObject({ ok: false });
    expect(!v.ok && v.error).toMatch(/ERR_NAME_NOT_RESOLVED/);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess1");
  });

  it("gives up at the time limit and still deletes the browser", async () => {
    const k = fakeKernel(() => new Promise(() => {}));
    const v = await visitInCloud("https://slow.example/", { client: k, timeoutMs: 50 });
    expect(v).toMatchObject({ ok: false });
    expect(!v.ok && v.error).toMatch(/time/i);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess1");
  });

  it("says so honestly when KERNEL isn't set up, without trying", async () => {
    const v = await visitInCloud("https://bargainpods.shop/", { apiKey: "" });
    expect(v).toEqual({ ok: false, url: "https://bargainpods.shop/", error: "The cloud browser (KERNEL) isn't set up, so the link wasn't opened." });
  });

  it("refuses anything but http and https", async () => {
    const k = fakeKernel(async () => good);
    const v = await visitInCloud("file:///etc/passwd", { client: k });
    expect(v.ok).toBe(false);
    expect(k.browsers.create).not.toHaveBeenCalled();
  });

  it("treats a malformed result as a failure, not as facts", async () => {
    const k = fakeKernel(async () => ({ success: true, result: { title: 42 } }));
    const v = await visitInCloud("https://bargainpods.shop/", { client: k });
    expect(v.ok).toBe(false);
  });
});
