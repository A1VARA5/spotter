// The session as seen from a server component (pages), using Next's cookie store.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HH_COOKIE, UNLOCK_COOKIE, readHousehold, readUnlock } from "./auth";
import { getHousehold, type Household } from "@/core/households";
import type { Db } from "@/db";

export async function pageSession(db: Db): Promise<{ household: Household; unlocked: boolean } | null> {
  const jar = await cookies();
  const id = readHousehold(jar.get(HH_COOKIE)?.value);
  if (!id) return null;
  const household = await getHousehold(db, id);
  if (!household) return null; // deleted demo, or a stale cookie
  return { household, unlocked: readUnlock(jar.get(UNLOCK_COOKIE)?.value) === id };
}

/** Pages behind sign in send strangers to the front door. */
export async function requirePageSession(db: Db) {
  const s = await pageSession(db);
  if (!s) redirect("/?signin=1");
  return s;
}
