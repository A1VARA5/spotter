// Start over: clears this household's payments so the allowances are fresh. Holds already at PayPal simply expire.
import { getDeps } from "@/server/deps";
import { resetPayments } from "@/core/lifecycle";
import { requireSpotter } from "@/server/auth";

export async function POST(request: Request) {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  const { db } = await getDeps();
  return Response.json({ cleared: await resetPayments(db, s.householdId) });
}
