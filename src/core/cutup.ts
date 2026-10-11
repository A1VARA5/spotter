// "The same £150 cut up": an agent whose order was held or stopped tries again to the same payee, smaller (instalments)
// or as a subscription. Each piece may look fine on its own, so Spotter looks back a day for a held or stopped payment
// by the same agent to the same payee and says so.
import type { Db } from "@/db";
import { normName } from "./rules";

export type CutUp = { payee: string; held: number; currency: string; paymentId: string; status: string };

const WINDOW_HOURS = 24;
const STOPPED = ["needs_approval", "blocked", "protected", "voided", "voiding"];

/** The biggest held or stopped payment by this agent to the same payee in the last day, or null. */
export async function findCutUp(db: Db, agentId: string, payee: string): Promise<CutUp | null> {
  const want = normName(payee);
  if (!want) return null;
  const rows = await db.query<{ id: string; amount: string; currency: string; status: string; payee: string }>(
    `select id, amount, currency, status, request->'payee'->>'name' as payee from payments
     where spender_id = $1 and status = any($2) and created_at > now() - make_interval(hours => $3) order by amount desc`,
    [agentId, STOPPED, WINDOW_HOURS],
  );
  const hit = rows.find((r) => normName(r.payee ?? "") === want);
  return hit ? { payee: hit.payee, held: Number(hit.amount), currency: hit.currency, paymentId: hit.id, status: hit.status } : null;
}
