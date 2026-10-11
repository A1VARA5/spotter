// "Someone switched Spotter off". Scammers coach people to remove protections ("disconnect that app, it's blocking
// the refund"). When a protection goes away by someone other than the spotter, the spotter hears right away, on their
// channels and in the app:
// - PayPal says the household's PayPal login consent was revoked (IDENTITY.AUTHORIZATION-CONSENT.REVOKED webhook)
// - a protected person's chat or email was taken over by a pairing code from a different Spotter family
// - a protected person blocked Spotter's chat
// Removing a person needs the spotter's PIN, so that is the spotter and isn't warned about. Each warning happens once
// (warnings.key). A channel that fails to deliver never hides the warning: it is stored first and shown in the app.
import type { Db } from "@/db";
import type { Deps } from "./lifecycle";

export const CONSENT_REVOKED = "IDENTITY.AUTHORIZATION-CONSENT.REVOKED";

export type WarningKind = "paypal_disconnected" | "channel_moved" | "chat_blocked";
export type Warning = { kind: WarningKind; text: string };
/** Sends a warning to a household's spotter on every channel they connected. Throws if any channel failed. */
export type Warn = (householdId: string, w: Warning) => Promise<void>;
export type StoredWarning = { id: string; kind: WarningKind; text: string; at: string };

const SCAM_LINE = "scammers often ask people to do this.";

export function disconnectedText(name: string, what: string): string {
  return `${name}'s ${what} was just disconnected from Spotter. If they didn't mean to, ring them: ${SCAM_LINE}`;
}
export const blockedText = (name: string) => `${name} just blocked Spotter's chat, so Spotter can't answer them there. If they didn't mean to, ring them: ${SCAM_LINE}`;
export const paypalDisconnectedText = (household: string) =>
  `The PayPal login for ${household} was just disconnected from Spotter. If you didn't mean to, check with the people you look out for: ${SCAM_LINE}`;

/** Stores the warning (once per key), then sends it. Returns false if this key was already warned about. Never throws
 * for a delivery failure: the stored warning still shows on the dashboard. */
export async function warnSpotter(deps: { db: Db; warn?: Warn; defer?: Deps["defer"] }, householdId: string, key: string, w: Warning): Promise<boolean> {
  if (!(await storeWarning(deps.db, householdId, key, w))) return false;
  await sendWarning(deps, householdId, w);
  return true;
}

/** The half that can't be lost: the dashboard copy. False if this key was already stored. */
export async function storeWarning(db: Db, householdId: string, key: string, w: Warning): Promise<boolean> {
  const rows = await db.query(
    "insert into warnings (household_id, key, kind, text) values ($1, $2, $3, $4) on conflict (key) do nothing returning id",
    [householdId, key.slice(0, 200), w.kind, w.text],
  );
  if (rows.length) console.info(`[spotter] warning stored for household ${householdId}: ${w.kind}`);
  return rows.length > 0;
}

/** The channels half. Never throws: a failed channel is logged and the stored copy still shows in the app. */
export function sendWarning(deps: { warn?: Warn; defer?: Deps["defer"] }, householdId: string, w: Warning): Promise<void> {
  const warn = deps.warn;
  if (!warn) return Promise.resolve();
  const send = async () => {
    try {
      await warn(householdId, w);
    } catch (e) {
      console.error(`[spotter] the ${w.kind} warning for ${householdId} couldn't be sent on every channel (it still shows in the app):`, e instanceof Error ? e.message : e);
    }
  };
  // After the response when we can (webhooks and Discord should answer quickly), otherwise now.
  if (deps.defer) {
    deps.defer(send);
    return Promise.resolve();
  }
  return send();
}

/** Recent warnings the spotter hasn't dismissed, newest first. */
export async function listWarnings(db: Db, householdId: string): Promise<StoredWarning[]> {
  const rows = await db.query<{ id: string | number; kind: WarningKind; text: string; at: string | Date }>(
    "select id, kind, text, at from warnings where household_id = $1 and seen_at is null and at > now() - interval '14 days' order by at desc limit 5",
    [householdId],
  );
  return rows.map((r) => ({ id: String(r.id), kind: r.kind, text: r.text, at: new Date(r.at).toISOString() }));
}

export async function dismissWarning(db: Db, householdId: string, id: string): Promise<boolean> {
  if (!/^\d{1,18}$/.test(id)) return false;
  const rows = await db.query("update warnings set seen_at = now() where id = $1 and household_id = $2 and seen_at is null returning id", [id, householdId]);
  return rows.length > 0;
}

// PayPal documents no fields for this event (docs/paypal-notes.md); real integrations read payer_id or merchant_id.
// Households hold the OpenID user_id, which can be a URL ending in the id, so both the whole value and its last part count.
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9:/._-]{0,199}$/;
const last = (s: string) => s.slice(s.lastIndexOf("/") + 1);

/** IDENTITY.AUTHORIZATION-CONSENT.REVOKED: warn every household whose PayPal login it names. Returns how many. */
export async function consentRevoked(deps: Pick<Deps, "db" | "warn" | "defer">, eventId: string, resource: Record<string, unknown>): Promise<number> {
  const ids = [resource.user_id, resource.payer_id, resource.merchant_id, resource.sub].filter((v): v is string => typeof v === "string" && ACCOUNT_ID.test(v));
  if (!ids.length) return 0;
  const tails = ids.map(last).filter(Boolean);
  const households = await deps.db.query<{ id: string; name: string }>(
    "select id, name from households where paypal_user_id = any($1) or regexp_replace(paypal_user_id, '^.*/', '') = any($2)",
    [ids, tails],
  );
  let warned = 0;
  for (const hh of households) {
    if (await warnSpotter(deps, hh.id, `paypal:${eventId}:${hh.id}`, { kind: "paypal_disconnected", text: paypalDisconnectedText(hh.name) })) warned++;
  }
  return warned;
}
