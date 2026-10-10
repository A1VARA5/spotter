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

export async function networkCount(db: Db, identifier: string, householdId: string): Promise<{ families: number; last?: string }> {
  if (!normName(identifier)) return { families: 0 };
  const rows = await db.query<{ families: string | number; last: string | null }>(
    `select count(*) as families, max(at) as last from reports
     where key = $1 and household_id <> $2 and at > now() - interval '${WINDOW_DAYS} days'`,
    [reportKey(identifier), householdId],
  );
  const families = Number(rows[0]?.families ?? 0);
  return families ? { families, last: String(rows[0]!.last) } : { families };
}
