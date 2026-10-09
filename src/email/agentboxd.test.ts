// Ported from Red Flag's security tests.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { htmlToText, senderOf, senderVerified, verifyMailroom } from "./agentboxd";

describe("agentboxd", () => {
  it("only trusts senders proven to own their From address", () => {
    const gmail = "mx.agentboxd.com; dkim=pass header.i=@gmail.com; spf=pass smtp.mailfrom=me@gmail.com; dmarc=pass header.from=gmail.com";
    expect(senderVerified({ from: "Me <me@gmail.com>", headers: { "authentication-results": gmail } })).toBe(true);
    const forged = "mx.agentboxd.com; dkim=pass header.d=attacker.com; spf=pass smtp.mailfrom=bounce@attacker.com; dmarc=none header.from=victim.org";
    expect(senderVerified({ from: "boss@victim.org", headers: { "Authentication-Results": forged } })).toBe(false);
    expect(senderVerified({ from: "boss@victim.org", headers: { "authentication-results": "mx.agentboxd.com; dkim=pass header.d=mail.victim.org; dmarc=none" } })).toBe(true);
    expect(senderVerified({ from: "me@gmail.com", headers: { "authentication-results": "mx.agentboxd.com; dkim=pass header.i=@gmail.com; dmarc=fail" } })).toBe(false);
    expect(senderVerified({ from: "me@gmail.com", headers: {} })).toBe(false);
    expect(senderVerified({ from: "me@gmail.com", headers: { "authentication-results": gmail }, labels: ["ai:spoofed-sender"] })).toBe(false);
    expect(senderVerified({ from: "me@gmail.com", headers: { "authentication-results": "attacker.example; dmarc=pass header.from=gmail.com" } })).toBe(false);
  });

  it("checks webhook signatures within a time window", () => {
    process.env.AGENTBOXD_WEBHOOK_SECRET = "test-secret";
    const body = '{"id":"evt_1"}';
    const now = String(Math.floor(Date.now() / 1000));
    const good = createHmac("sha256", "test-secret").update(`${now}.${body}`).digest("hex");
    expect(verifyMailroom(body, now, good)).toBe(true);
    expect(verifyMailroom(body + " ", now, good)).toBe(false);
    expect(verifyMailroom(body, String(Number(now) - 3600), good)).toBe(false);
    expect(verifyMailroom(body, "not a number", good)).toBe(false);
    delete process.env.AGENTBOXD_WEBHOOK_SECRET;
    expect(verifyMailroom(body, now, good)).toBe(false);
  });

  it("reads the real address, not one hidden in the display name", () => {
    expect(senderOf({ from: '"<ceo@bank.com>" <Gran@Example.com>' })).toBe("gran@example.com");
    expect(senderOf({ from: { address: "A@B.com" } })).toBe("a@b.com");
  });

  it("keeps a link's real target next to its label", () => {
    expect(htmlToText('<p>Pay at <a href="https://evil.example/pay">paypal.com</a></p>')).toContain("(https://evil.example/pay) paypal.com");
  });
});
