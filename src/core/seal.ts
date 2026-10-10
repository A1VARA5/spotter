// Seals a value the server must keep but the browser must never read (KERNEL's replay link carries a signed token
// with KERNEL account ids). AES-256-GCM with a key derived from SESSION_SECRET, so a sealed value can sit inside
// rows that are sent to the browser, and only the server can open it. Tampering makes open() return null.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(purpose: string): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return createHash("sha256").update(`seal:${purpose}:${s}`).digest();
}

export function seal(purpose: string, value: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function open(purpose: string, sealed: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url")) as [Buffer, Buffer, Buffer];
    const d = createDecipheriv("aes-256-gcm", key(purpose), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
