// The spotter's session. Only the person holding the PIN can approve, deny or reset; agents and
// strangers can ask to pay but can never say yes to themselves.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "spotter_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function token(): string | null {
  const pin = process.env.SPOTTER_PIN;
  const secret = process.env.SPOTTER_SECRET;
  if (!pin || !secret) return null;
  return createHmac("sha256", secret).update(`spotter:${pin}`).digest("base64url");
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function checkPin(pin: string): boolean {
  const expected = process.env.SPOTTER_PIN;
  return Boolean(expected && pin && same(pin, expected));
}

export function sessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${THIRTY_DAYS}${secure}`;
}

export function isSpotter(request: Request): boolean {
  const expected = token();
  if (!expected) return process.env.NODE_ENV !== "production"; // local dev without a PIN set
  const cookie = request.headers.get("cookie") ?? "";
  const value = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return Boolean(value && same(value, expected));
}

export const notSpotter = () =>
  Response.json({ error: "Only the spotter can do that. Enter the spotter PIN on the dashboard." }, { status: 401 });
