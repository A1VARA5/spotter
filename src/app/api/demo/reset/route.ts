// Demo only: start the sandbox demo from a clean slate. Holds already at PayPal simply expire.
import { getDeps } from "@/server/deps";
import { resetPayments } from "@/core/lifecycle";

export async function POST() {
  const { db } = await getDeps();
  return Response.json({ cleared: await resetPayments(db) });
}
