// Photo check for the signed in family: a screenshot of a message is read and its words checked, a photo of things is
// priced at real shops, and an unclear picture asks which. Nothing here moves money, so it needs the spotter's session
// but not the PIN. The picture is checked in memory and never stored; caps and cache live in src/core/picture.ts and
// src/market/photo.ts.
import { householdFrom } from "@/server/auth";
import { getDeps } from "@/server/deps";
import { imageFrom, MAX_PHOTO_BYTES, householdCurrency, parseAmount, photoCheck } from "@/market/photo";
import { pictureDeps, photoDeps } from "@/server/photo";
import { routePicture, screenshotText } from "@/core/picture";
import { checkWordsOnly } from "@/ai/scan";
import { extractPayment } from "@/ai/extract";

export const maxDuration = 60;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export async function POST(request: Request) {
  const hh = householdFrom(request);
  if (!hh) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { image?: unknown; mode?: unknown; amount?: unknown; what?: unknown } | null;
  const image = typeof body?.image === "string" ? body.image : "";
  if (!image || image.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 || !B64.test(image)) {
    return Response.json({ error: "Choose a photo first (JPEG, PNG or WEBP, under 4 MB)." }, { status: 400 });
  }
  const img = imageFrom(Buffer.from(image, "base64"));
  if (!img) return Response.json({ error: "That file isn't a photo Spotter can open. Use a JPEG, PNG or WEBP under 4 MB." }, { status: 400 });
  const mode = body?.mode === "sell" ? "sell" : "buy";
  const what = body?.what === "message" || body?.what === "prices" ? body.what : null;
  try {
    const deps = await getDeps();
    const db = deps.db;
    const currency = await householdCurrency(db, hh);
    const amount = typeof body?.amount === "string" && body.amount.trim() ? body.amount.slice(0, 40) : null;
    const quoted = amount === null ? null : parseAmount(amount, currency);
    if (amount !== null && quoted === null) return Response.json({ error: "Type the amount as a number, like 49 or 1,250." }, { status: 400 });

    // Without a model key on this server, every picture is a price check.
    const route = process.env.ANTHROPIC_API_KEY ? await routePicture(pictureDeps(db, hh), img.bytes, img.type, what) : ({ route: "prices" } as const);
    if (route.route === "error") return Response.json({ error: route.error }, { status: route.status });
    if (route.route === "ask") return Response.json({ ask: true });
    if (route.route === "message") {
      const check = await checkWordsOnly(deps.check, (t) => extractPayment(t), screenshotText(route.read));
      return Response.json({ words: { from: route.read.from, text: route.read.text, injection: route.read.injection, check } });
    }
    const r = await photoCheck(photoDeps(db, hh), { bytes: img.bytes, mode, currency, quoted });
    return r.ok ? Response.json({ result: r.result }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    console.error(`[spotter] photo check failed for ${hh}:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "Spotter couldn't check this photo just now. Try again in a minute." }, { status: 500 });
  }
}
