import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramLogin } from "./login";

const TOKEN = "123:ABC";
const now = 1_791_600_000;

function signed(fields: Record<string, string>) {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const hash = createHmac("sha256", createHash("sha256").update(TOKEN).digest()).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash });
}

describe("verifyTelegramLogin", () => {
  const base = { id: "4242", first_name: "Sam", username: "sam", auth_date: String(now - 60) };

  it("accepts data Telegram signed with this bot's token", () => {
    expect(verifyTelegramLogin(signed(base), TOKEN, now)).toEqual({ id: "4242", name: "Sam" });
  });

  it("rejects anything edited after signing", () => {
    const p = signed(base);
    p.set("id", "9999");
    expect(verifyTelegramLogin(p, TOKEN, now)).toBeNull();
  });

  it("rejects a login more than a day old, a missing hash, or another bot's token", () => {
    expect(verifyTelegramLogin(signed({ ...base, auth_date: String(now - 90_000) }), TOKEN, now)).toBeNull();
    const p = signed(base);
    p.delete("hash");
    expect(verifyTelegramLogin(p, TOKEN, now)).toBeNull();
    expect(verifyTelegramLogin(signed(base), "999:OTHER", now)).toBeNull();
  });
});
