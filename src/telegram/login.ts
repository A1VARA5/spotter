// The Telegram Login Widget: Telegram sends the user's id and name, signed with a key made from our bot
// token (core.telegram.org/widgets/login#checking-authorization). Anything unsigned, edited or stale is refused.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_S = 86_400;

export function verifyTelegramLogin(params: URLSearchParams, botToken: string, nowS = Math.floor(Date.now() / 1000)): { id: string; name: string } | null {
  const hash = params.get("hash");
  const id = params.get("id");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !id || !/^\d{1,20}$/.test(id) || !Number.isFinite(authDate) || nowS - authDate > MAX_AGE_S) return null;
  const check = [...params.keys()]
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${params.get(k)}`)
    .join("\n");
  const want = createHmac("sha256", createHash("sha256").update(botToken).digest()).update(check).digest();
  const got = Buffer.from(hash, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return { id, name: params.get("first_name") ?? params.get("username") ?? "you" };
}
