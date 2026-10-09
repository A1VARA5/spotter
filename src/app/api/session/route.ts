// Spotter sign in with the PIN. Sets an httpOnly session cookie.
import { checkPin, isSpotter, sessionCookie } from "@/server/auth";

export async function POST(request: Request) {
  const { pin } = (await request.json().catch(() => ({}))) as { pin?: unknown };
  if (typeof pin !== "string" || !checkPin(pin.trim())) {
    return Response.json({ error: "That PIN isn't right." }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie() } });
}

export async function GET(request: Request) {
  return Response.json({ spotter: isSpotter(request) });
}
