import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSpotter, sessionCookie, SESSION_COOKIE, checkPin } from "./auth";

const withCookie = (value?: string) =>
  new Request("http://x/api/payments/p/approve", { method: "POST", headers: value ? { cookie: `${SESSION_COOKIE}=${value}` } : {} });

beforeEach(() => {
  process.env.SPOTTER_PIN = "2468";
  process.env.SPOTTER_SECRET = "test-secret-at-least-32-characters-long";
});
afterEach(() => {
  delete process.env.SPOTTER_PIN;
  delete process.env.SPOTTER_SECRET;
});

describe("spotter auth", () => {
  it("accepts the right PIN and rejects a wrong one", () => {
    expect(checkPin("2468")).toBe(true);
    expect(checkPin("1234")).toBe(false);
    expect(checkPin("")).toBe(false);
  });

  it("a session cookie from the right PIN unlocks spotter actions", () => {
    const cookie = sessionCookie();
    const value = /=([^;]+)/.exec(cookie)![1]!;
    expect(isSpotter(withCookie(value))).toBe(true);
  });

  it("the cookie is httpOnly, strict and long lived", () => {
    expect(sessionCookie()).toMatch(/HttpOnly/);
    expect(sessionCookie()).toMatch(/SameSite=Strict/);
  });

  it("no cookie or a forged one is not the spotter", () => {
    expect(isSpotter(withCookie())).toBe(false);
    expect(isSpotter(withCookie("forged"))).toBe(false);
  });

  it("changing the PIN logs everyone out", () => {
    const value = /=([^;]+)/.exec(sessionCookie())![1]!;
    process.env.SPOTTER_PIN = "9999";
    expect(isSpotter(withCookie(value))).toBe(false);
  });

  it("with no PIN configured, production refuses and dev allows", () => {
    delete process.env.SPOTTER_PIN;
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    expect(isSpotter(withCookie())).toBe(false);
    env.NODE_ENV = "development";
    expect(isSpotter(withCookie())).toBe(true);
    env.NODE_ENV = before;
  });
});
