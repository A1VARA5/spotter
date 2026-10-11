// The Spotter network: when a family says no to a payee (or a rule blocks one on a strong scam sign), other
// families get told "N other Spotter families said no to this". Only an HMAC of the identifier is stored,
// so the table can't be read back into a list of emails, and your own family never counts towards your number.
import { createHmac } from "node:crypto";
import type { Db } from "@/db";
import { normName } from "./rules";

const WINDOW_DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return s;
}

export const reportKey = (identifier: string) => createHmac("sha256", secret()).update(`report:${normName(identifier)}`).digest("hex");

export async function fileReport(db: Db, r: { householdId: string; identifier: string; kind: "denied" | "blocked" }) {
  if (!normName(r.identifier)) return;
  await db.query(
    "insert into reports (key, household_id, kind) values ($1, $2, $3) on conflict (key, household_id) do update set kind = excluded.kind, at = now()",
    [reportKey(r.identifier), r.householdId, r.kind],
  );
}

export type NetworkCount = { families: number; last?: string; demo: boolean };

/**
 * Other families that said no to this payee in the window. Demo families (people trying the demo) and real families
 * are kept apart: a demo visitor's count is other demo visitors, and a real family never counts demo clicks.
 * demo: which kind was counted, so the words can say so (networkLine).
 */
export async function networkCount(db: Db, identifier: string, householdId: string): Promise<NetworkCount> {
  const [me] = await db.query<{ demo: boolean }>("select demo from households where id = $1", [householdId]);
  // No household row (a bad id, or a demo family cleaned up mid request): never show it real families' reports.
  if (!me) console.warn(`[spotter] network count: household ${householdId} not found, counting demo families only`);
  const demo = !me || me.demo === true;
  if (!normName(identifier)) return { families: 0, demo };
  const rows = await db.query<{ families: string | number; last: string | null }>(
    `select count(*) as families, max(r.at) as last from reports r join households h on h.id = r.household_id
     where r.key = $1 and r.household_id <> $2 and h.demo = $3 and r.at > now() - interval '${WINDOW_DAYS} days'`,
    [reportKey(identifier), householdId, demo],
  );
  const families = Number(rows[0]?.families ?? 0);
  return families ? { families, last: String(rows[0]!.last), demo } : { families, demo };
}

/** The count in words: "Spotter families" for real ones, "demo families" (said plainly) for the demo. */
export function networkLine(n: Pick<NetworkCount, "families" | "demo">, payee: string): string {
  const kind = n.demo ? "demo" : "Spotter";
  if (!n.families) return `No other ${kind} family has said no to ${payee} in the last ${WINDOW_DAYS} days.`;
  const who = `${n.families} other ${kind} famil${n.families === 1 ? "y" : "ies"}${n.demo ? " (other people trying the demo)" : ""}`;
  return `${who} said no to ${payee} in the last ${WINDOW_DAYS} days.`;
}
