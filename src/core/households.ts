// A household is one spotter and the people they look out for. Everything else hangs off it.
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import { createSpender, type Spender } from "./lifecycle";
import { NOT_LAB_SQL } from "./tripped";
import { DEMO_SPENDERS, DEMO_SPOTTER } from "@/server/seed";

/** A family (the main story) or a small business. Business only changes words and starter rules. */
export type HouseholdKind = "family" | "business";
export const HOUSEHOLD_KINDS: readonly HouseholdKind[] = ["family", "business"];

export type Household = {
  id: string;
  name: string;
  spotter_name: string;
  paypal_user_id: string | null;
  email: string | null;
  telegram_chat_id: string | null;
  discord_user_id: string | null;
  alert_email: string | null;
  pin_hash: string | null;
  demo: boolean;
  kind: HouseholdKind;
  /** IANA time zone for "ask again tomorrow at 9am" (core/sleep.ts). Optional so older fixtures still type check. */
  time_zone?: string;
  created_at: string;
};

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

export async function createHousehold(
  db: Db,
  h: { name: string; spotterName: string; paypalUserId?: string; email?: string; demo?: boolean; kind?: HouseholdKind },
): Promise<Household> {
  const rows = await db.query<Household>(
    "insert into households (id, name, spotter_name, paypal_user_id, email, demo, kind) values ($1, $2, $3, $4, $5, $6, $7) returning *",
    [newId("hh"), h.name, h.spotterName, h.paypalUserId ?? null, h.email ?? null, h.demo ?? false, h.kind ?? "family"],
  );
  return rows[0]!;
}

export async function getHousehold(db: Db, id: string): Promise<Household | null> {
  return (await db.query<Household>("select * from households where id = $1", [id]))[0] ?? null;
}

/** The family's people and agents. The agent lab's test agent is left out unless `lab` is asked for (to name its payments). */
export async function listSpenders(db: Db, householdId: string, opts: { lab?: boolean } = {}): Promise<Spender[]> {
  return db.query<Spender>(`select * from spenders s where household_id = $1 ${opts.lab ? "" : `and ${NOT_LAB_SQL}`} order by created_at, id`, [householdId]);
}

/** A throwaway family for one visitor. The PIN is set by the caller (see DEMO_PIN). */
export async function createDemoHousehold(db: Db): Promise<Household> {
  const hh = await createHousehold(db, { name: "The demo family", spotterName: DEMO_SPOTTER, demo: true });
  for (const s of DEMO_SPENDERS) await createSpender(db, { ...s, id: newId("sp"), householdId: hh.id, spotterName: DEMO_SPOTTER });
  return hh;
}

/** Demo families are deleted after a while, with their spenders and payments. Real households never are. */
export async function deleteStaleDemoHouseholds(db: Db, olderThanHours = 48): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "delete from households where demo and created_at < now() - make_interval(hours => $1) returning id",
    [olderThanHours],
  );
  return rows.length;
}
