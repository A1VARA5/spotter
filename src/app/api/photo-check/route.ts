// Photo price check for the signed in family. Nothing here moves money, so it needs the spotter's session but not
// the PIN. The photo is checked and sent to Channel3, never stored; caps and cache live in src/market/photo.ts.
import { householdFrom } from "@/server/auth";
import { getDb } from "@/db";
import { MAX_PHOTO_BYTES, householdCurrency, parseAmount, photoCheck } from "@/market/photo";
import { photoDeps } from "@/server/photo";

export const maxDuration = 60;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export async function POST(request: Request) {
  const hh = householdFrom(request);
  if (!hh) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { image?: unknown; mode?: unknown; amount?: unknown } | null;
  const image = typeof body?.image === "string" ? body.image : "";
  if (!image || image.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 || !B64.test(image)) {
    return Response.json({ error: "Choose a photo first (JPEG, PNG or WEBP, under 4 MB)." }, { status: 400 });
  }
  const mode = body?.mode === "sell" ? "sell" : "buy";
  try {
    const db = await getDb();
    const currency = await householdCurrency(db, hh);
    const amount = typeof body?.amount === "string" && body.amount.trim() ? body.amount.slice(0, 40) : null;
    const quoted = amount === null ? null : parseAmount(amount, currency);
    if (amount !== null && quoted === null) return Response.json({ error: "Type the amount as a number, like 49 or 1,250." }, { status: 400 });
    const r = await photoCheck(photoDeps(db, hh), { bytes: Buffer.from(image, "base64"), mode, currency, quoted });
    return r.ok ? Response.json({ result: r.result }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    console.error(`[spotter] photo check failed for ${hh}:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "Spotter couldn't check this photo just now. Try again in a minute." }, { status: 500 });
  }
}
