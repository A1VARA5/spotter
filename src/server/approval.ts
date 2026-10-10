// Approving moves real money, so it needs the spotter's PIN every time (an unlocked session isn't enough),
// and it waits while Spotter is still looking into a fresh hold: nobody should pay before seeing what it found.
import type { Db } from "@/db";
import { checkPin } from "./auth";

/** The case agent has 45 seconds at most; after this a missing case file means it never came. */
export const CASE_WAIT_SECONDS = 50;

const json = (body: unknown, status: number) => Response.json(body, { status });

/** Null when the approval may go ahead, otherwise the response to send back. */
export async function checkApproval(db: Db, householdId: string, paymentId: string, pin: unknown): Promise<Response | null> {
  if (typeof pin !== "string" || !pin) return json({ error: "Enter your PIN to approve a payment.", needsPin: true }, 400);
  const [p] = await db.query<{ status: string; waiting: boolean }>(
    `select p.status, (p.case_file is null and p.created_at > now() - make_interval(secs => $3)) as waiting
     from payments p join spenders s on s.id = p.spender_id where p.id = $1 and s.household_id = $2`,
    [paymentId, householdId, CASE_WAIT_SECONDS],
  );
  // Unknown or someone else's payment: let the normal handler give its usual 404.
  if (!p) return null;
  const ok = await checkPin(db, householdId, pin);
  if (ok === "locked") return json({ error: "Too many wrong PINs. Try again in a few minutes." }, 429);
  if (ok === "wrong") return json({ error: "That PIN isn't right.", needsPin: true }, 403);
  if (p.status === "needs_approval" && p.waiting) return json({ error: "Spotter is still looking into this one. Give it a few seconds, then decide." }, 409);
  return null;
}
