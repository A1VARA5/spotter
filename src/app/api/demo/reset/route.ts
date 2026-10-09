// Demo only: start the sandbox demo from a clean slate. Spotter only. Holds already at PayPal simply expire.
import { getDeps } from "@/server/deps";
import { resetPayments } from "@/core/lifecycle";
import { isSpotter, notSpotter } from "@/server/auth";

export async function POST(request: Request) {
  if (!isSpotter(request)) return notSpotter();
  const { db } = await getDeps();
  return Response.json({ cleared: await resetPayments(db) });
}
