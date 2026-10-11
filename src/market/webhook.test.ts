import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleChannel3Webhook, verifySvix } from "./webhook";

const KEY = Buffer.from("a-test-signing-key-32-bytes-long!!");
const SECRET = `whsec_${KEY.toString("base64")}`;
const sign = (id: string, ts: string, body: string, key = KEY) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
const now = () => Math.floor(Date.now() / 1000).toString();

const EVENT = JSON.stringify({ type: "price.changed", canonical_product_id: "VpRxZ86", old_price: 179, new_price: 1, currency: "GBP", buy_url: "https://evil.example", timestamp: "2026-10-11T00:00:00Z" });

function req(body: string, headers: Record<string, string> = {}) {
  return new Request("https://x/api/channel3/webhook", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}
function signed(body: string, ts = now(), id = "msg_1") {
  return req(body, { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,bm90IGl0 ${sign(id, ts, body)}` });
}

describe("verifySvix", () => {
  it("accepts Channel3's Svix signature over id.timestamp.body", () => {
    const ts = now();
    expect(verifySvix(EVENT, { id: "m", timestamp: ts, signature: sign("m", ts, EVENT) }, SECRET)).toBe(true);
  });

  it("refuses a changed body, a wrong key, missing headers and an old timestamp", () => {
    const ts = now();
    expect(verifySvix(EVENT + " ", { id: "m", timestamp: ts, signature: sign("m", ts, EVENT) }, SECRET)).toBe(false);
    expect(verifySvix(EVENT, { id: "m", timestamp: ts, signature: sign("m", ts, EVENT, Buffer.from("other")) }, SECRET)).toBe(false);
    expect(verifySvix(EVENT, { id: null, timestamp: ts, signature: sign("m", ts, EVENT) }, SECRET)).toBe(false);
    const old = (Math.floor(Date.now() / 1000) - 600).toString();
    expect(verifySvix(EVENT, { id: "m", timestamp: old, signature: sign("m", old, EVENT) }, SECRET)).toBe(false);
  });
});

describe("handleChannel3Webhook", () => {
  it("with a secret set, refuses an unsigned or badly signed delivery and checks nothing", async () => {
    const hint = vi.fn(async () => 1);
    expect((await handleChannel3Webhook(req(EVENT), SECRET, hint)).status).toBe(401);
    expect((await handleChannel3Webhook(req(EVENT, { "svix-id": "m", "svix-timestamp": now(), "svix-signature": "v1,AAAA" }), SECRET, hint)).status).toBe(401);
    expect(hint).not.toHaveBeenCalled();
  });

  it("passes only the product id on, never the price or link in the payload", async () => {
    const hint = vi.fn(async () => 1);
    const res = await handleChannel3Webhook(signed(EVENT), SECRET, hint);
    expect(res.status).toBe(200);
    expect(hint).toHaveBeenCalledWith("VpRxZ86");
    expect(await res.json()).toEqual({ checked: 1 });
  });

  it("without a secret, still treats the delivery as a hint only", async () => {
    const hint = vi.fn(async () => 0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await handleChannel3Webhook(req(EVENT), undefined, hint)).status).toBe(200);
    expect(hint).toHaveBeenCalledWith("VpRxZ86");
    expect(warn.mock.calls.flat().join(" ")).toContain("CHANNEL3_WEBHOOK_SECRET");
  });

  it("ignores other event types and odd product ids, and says 400 for a body that isn't JSON", async () => {
    const hint = vi.fn(async () => 0);
    expect((await handleChannel3Webhook(req(JSON.stringify({ type: "other", canonical_product_id: "a" })), undefined, hint)).status).toBe(200);
    expect((await handleChannel3Webhook(req(JSON.stringify({ type: "price.changed", canonical_product_id: "../x" })), undefined, hint)).status).toBe(200);
    expect(hint).not.toHaveBeenCalled();
    expect((await handleChannel3Webhook(req("not json"), undefined, hint)).status).toBe(400);
  });

  it("answers 500 when checking fails, so Svix retries", async () => {
    const hint = vi.fn(async () => {
      throw new Error("db down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await handleChannel3Webhook(req(EVENT), undefined, hint)).status).toBe(500);
  });
});
