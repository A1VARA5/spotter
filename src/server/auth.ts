// Sessions. A signed cookie says which household you are; a second, short lived cookie says you have
// unlocked it with the household's PIN. Only an unlocked spotter can approve, deny or change anything.
// Agents and spenders never get either cookie.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "@/db";

export const HH_COOKIE = "spotter_hh";
export const UNLOCK_COOKIE = "spotter_unlock";
const THIRTY_DAYS = 60 * 60 * 24 * 30;
const TWELVE_HOURS = 60 * 60 * 12;
const MAX_TRIES = 5;
const LOCK_MINUTES = 15;

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return s;
}

const sign = (kind: string, body: string) => createHmac("sha256", secret()).update(`${kind}:${body}`).digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function make(kind: string, householdId: string): string {
  const body = `${householdId}.${Math.floor(Date.now() / 1000)}`;
  return `${body}.${sign(kind, body)}`;
}

function read(kind: string, value: string | undefined, maxAge: number): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, issued, mac] = parts as [string, string, string];
  if (!same(mac, sign(kind, `${id}.${issued}`))) return null;
  const age = Date.now() / 1000 - Number(issued);
  return Number.isFinite(age) && age >= 0 && age <= maxAge ? id : null;
}

function cookie(request: Request, name: string): string | undefined {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

/** Lax so the session survives the redirect back from PayPal's login page. */
export const householdCookie = (id: string) =>
  `${HH_COOKIE}=${make("hh", id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS}${secure()}`;
export const unlockCookie = (id: string) =>
  `${UNLOCK_COOKIE}=${make("unlock", id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TWELVE_HOURS}${secure()}`;
export const clearCookies = () => [HH_COOKIE, UNLOCK_COOKIE].map((n) => `${n}=; Path=/; HttpOnly; Max-Age=0${secure()}`);

export const householdFrom = (request: Request) => readHousehold(cookie(request, HH_COOKIE));
export const isUnlocked = (request: Request, householdId: string) => readUnlock(cookie(request, UNLOCK_COOKIE)) === householdId;
/** For server components, which get cookie values rather than a Request. */
export const readHousehold = (value: string | undefined) => read("hh", value, THIRTY_DAYS);
export const readUnlock = (value: string | undefined) => read("unlock", value, TWELVE_HOURS);

/** For routes that change money or settings: the signed in household, unlocked. Otherwise a 401 to return. */
export function requireSpotter(request: Request): { householdId: string } | Response {
  const householdId = householdFrom(request);
  if (!householdId) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!isUnlocked(request, householdId)) return Response.json({ error: "Enter your PIN to do that.", locked: true }, { status: 401 });
  return { householdId };
}

export class InvalidPinError extends Error {
  name = "InvalidPinError";
}

export async function setPin(db: Db, householdId: string, pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new InvalidPinError("Use 4 to 8 digits.");
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt, 32);
  await db.query("update households set pin_hash = $2, pin_failures = 0, pin_locked_until = null where id = $1", [
    householdId,
    `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`,
  ]);
}

export async function checkPin(db: Db, householdId: string, pin: string): Promise<"ok" | "wrong" | "locked"> {
  const row = (
    await db.query<{ pin_hash: string | null; locked: boolean }>(
      "select pin_hash, coalesce(pin_locked_until > now(), false) as locked from households where id = $1",
      [householdId],
    )
  )[0];
  if (!row?.pin_hash) return "wrong";
  if (row.locked) return "locked";
  const [scheme, salt, stored] = row.pin_hash.split("$");
  const want = Buffer.from(stored ?? "", "base64url");
  if (scheme !== "scrypt" || !salt || want.length !== 32) {
    console.error(`[spotter] stored PIN for ${householdId} is malformed`);
    return "wrong";
  }
  const got = await scryptAsync(pin, Buffer.from(salt, "base64url"), 32);
  if (timingSafeEqual(got, want)) {
    await db.query("update households set pin_failures = 0 where id = $1", [householdId]);
    return "ok";
  }
  await db.query(
    `update households set pin_failures = pin_failures + 1,
       pin_locked_until = case when pin_failures + 1 >= $2 then now() + make_interval(mins => $3) else pin_locked_until end
     where id = $1`,
    [householdId, MAX_TRIES, LOCK_MINUTES],
  );
  return "wrong";
}
