// "Sleep on it": a held payment can wait a day. The PayPal hold stays exactly as it is, and at 9am household time
// tomorrow Spotter asks the spotter again on the same channels. Nothing here ever captures: if nobody approves,
// PayPal lets the hold go on its own and the money goes back.
// PayPal facts this relies on (docs/paypal-notes.md): a hold's funds are guaranteed for a 3 day honor period; it can
// be reauthorized ONCE, from day 4 to day 29, and the reauthorization comes back with a new authorisation id; the
// hold itself expires 29 days after it was made (PAYMENT.AUTHORIZATION.VOIDED fires then).
import type { Db } from "@/db";
import { PayPalError } from "@/paypal/client";
import { asDate, DAY, HONOR_DAYS, HOUR, holdEndsAt, LAST_REAUTH_DAY, nextNineAm, safeTz, whenText } from "./holdtime";
import { getPayment, getSpender, type Deps, type Payment } from "./lifecycle";
export { askingAgain, DEFAULT_TZ, holdEndLine, holdEndsAt, HOLD_DAYS, HONOR_DAYS, nextNineAm, safeTz, whenText } from "./holdtime";

async function event(db: Db, paymentId: string, type: string, data: Record<string, unknown> = {}) {
  await db.query("insert into events (payment_id, type, data) values ($1, $2, $3)", [paymentId, type, JSON.stringify(data)]);
}

export async function householdTz(db: Db, householdId: string): Promise<string> {
  const [row] = await db.query<{ time_zone: string | null }>("select time_zone from households where id = $1", [householdId]);
  return safeTz(row?.time_zone);
}

export type SleepResult = { ok: true; payment: Payment; until: Date; tz: string } | { ok: false; status: 404 | 409; error: string };

/** "Ask again tomorrow". Only for the household that owns the payment and only while it waits. A second tap the same
 * day changes nothing. Refused when PayPal would let the hold go before Spotter could ask again. Never calls PayPal. */
export async function askAgainTomorrow(deps: Pick<Deps, "db">, o: { id: string; householdId: string; by: string; now?: Date }): Promise<SleepResult> {
  const { db } = deps;
  const now = o.now ?? new Date();
  const p = await getPayment(db, o.id, o.householdId);
  if (!p) return { ok: false, status: 404, error: "No such payment." };
  if (p.status !== "needs_approval") return { ok: false, status: 409, error: "This payment has already been decided." };
  const tz = await householdTz(db, o.householdId);
  const until = nextNineAm(now, tz);
  const ends = holdEndsAt(p);
  if (ends.getTime() - until.getTime() < HOUR) {
    return {
      ok: false,
      status: 409,
      error: `PayPal lets this hold go on ${whenText(ends, tz)}, before Spotter could ask again. Decide today, or let it end: the money goes back and nothing is paid.`,
    };
  }
  const rows = await db.query<Payment>(
    "update payments set ask_again_at = $2, sleeps = sleeps + 1, updated_at = now() where id = $1 and status = 'needs_approval' and ask_again_at is distinct from $2 returning *",
    [p.id, until.toISOString()],
  );
  if (rows[0]) {
    await event(db, p.id, "sleeping", { by: o.by.slice(0, 60), until: until.toISOString() });
    return { ok: true, payment: rows[0], until, tz };
  }
  // Nothing changed: either it was already set for tomorrow (a double tap) or someone decided it meanwhile.
  const now2 = await getPayment(db, p.id);
  if (now2?.status === "needs_approval" && now2.ask_again_at && asDate(now2.ask_again_at).getTime() === until.getTime()) return { ok: true, payment: now2, until, tz };
  return { ok: false, status: 409, error: "This payment has already been decided." };
}

/** The morning run: every sleeping payment that is due is asked about again, once, on the spotter's channels. */
export async function askAgainDue(deps: Pick<Deps, "db" | "notify">, now = new Date()): Promise<number> {
  const { db } = deps;
  const due = await db.query<Payment>(
    "select * from payments where status = 'needs_approval' and ask_again_at is not null and ask_again_at <= $1 order by ask_again_at",
    [now.toISOString()],
  );
  let asked = 0;
  for (const p of due) {
    // Claimed by clearing the time, so two runs at once can't both send it.
    const [claimed] = await db.query<Payment>(
      "update payments set ask_again_at = null where id = $1 and status = 'needs_approval' and ask_again_at = $2 returning *",
      [p.id, p.ask_again_at],
    );
    if (!claimed) continue;
    asked++;
    await event(db, p.id, "asked_again");
    if (!deps.notify) continue;
    try {
      const spender = await getSpender(db, claimed.spender_id);
      if (!spender) throw new Error(`spender ${claimed.spender_id} not found`);
      await deps.notify(claimed, spender);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[spotter] asking again about ${p.id} failed: ${error}`);
      await event(db, p.id, "alert_failed", { error, step: "ask_again" }).catch((err) =>
        console.error(`[spotter] could not record the failed ask again for ${p.id}:`, err instanceof Error ? err.message : err),
      );
    }
  }
  return asked;
}

const TRY_AGAIN_ISSUES = new Set(["REAUTHORIZATION_TOO_SOON"]);

function reauthNote(issue: string | undefined): string {
  if (issue === "REAUTHORIZATION_NOT_SUPPORTED_FOR_PAYMENT_SOURCE" || issue === "REAUTHORIZATION_NOT_SUPPORTED") {
    return "PayPal can't renew this kind of hold, so after 3 days the money isn't guaranteed any more. The hold still ends on its own if nobody approves.";
  }
  if (issue === "AUTHORIZATION_VOIDED" || issue === "AUTHORIZATION_EXPIRED") return "PayPal says this hold has already ended, so nothing can be paid from it.";
  return `PayPal wouldn't renew this hold${issue ? ` (${issue})` : ""}. It still ends on its own if nobody approves.`;
}

/**
 * The daily job's half of "sleep on it": a sleeping hold past PayPal's 3 day honor period is reauthorized, once, while
 * it has more than a day left. Claimed first (reauth_tried_at) and sent with an idempotency key, so two runs or a
 * retry can't reauthorize twice. A PayPal outage is tried again next run; a firm no is written on the payment.
 */
export async function keepHoldsAlive(deps: Pick<Deps, "db" | "paypal">, now = new Date()): Promise<number> {
  const { db, paypal } = deps;
  const reauthorize = paypal.reauthorizeAuthorization;
  if (!reauthorize) return 0;
  const candidates = await db.query<Payment>(
    `select * from payments where status = 'needs_approval' and sleeps > 0 and paypal_authorization_id is not null
       and reauthorized_at is null and reauth_tried_at is null and created_at <= $1 and created_at > $2`,
    [new Date(now.getTime() - HONOR_DAYS * DAY).toISOString(), new Date(now.getTime() - LAST_REAUTH_DAY * DAY).toISOString()],
  );
  let renewed = 0;
  for (const p of candidates) {
    if (holdEndsAt(p).getTime() - now.getTime() <= DAY) continue;
    const [claimed] = await db.query<Payment>(
      "update payments set reauth_tried_at = now() where id = $1 and reauth_tried_at is null and status = 'needs_approval' returning *",
      [p.id],
    );
    if (!claimed) continue;
    const from = claimed.paypal_authorization_id!;
    let fresh: { authorizationId: string; expiresAt?: string };
    try {
      fresh = await reauthorize(from, `reauth-${p.id}`);
    } catch (e) {
      const issue = e instanceof PayPalError ? e.issue : undefined;
      const status = e instanceof PayPalError ? e.status : 0;
      const retry = !(e instanceof PayPalError) || status === 0 || status === 429 || status >= 500 || TRY_AGAIN_ISSUES.has(issue ?? "");
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[spotter] reauthorizing ${p.id} failed (${status} ${issue ?? ""}), ${retry ? "will try again tomorrow" : "not trying again"}: ${error}`);
      await db.query("update payments set reauth_tried_at = case when $2 then null else reauth_tried_at end, reauth_note = case when $2 then reauth_note else $3 end where id = $1", [
        p.id,
        retry,
        reauthNote(issue),
      ]);
      await event(db, p.id, "reauth_failed", { status, ...(issue ? { issue } : {}), retry, error: error.slice(0, 300) });
      continue;
    }
    const [moved] = await db.query(
      `update payments set paypal_authorization_id = $3, paypal_auth_expires_at = coalesce($4, paypal_auth_expires_at), reauthorized_at = now(), reauth_note = null
       where id = $1 and status = 'needs_approval' and paypal_authorization_id = $2 returning id`,
      [p.id, from, fresh.authorizationId, fresh.expiresAt ?? null],
    );
    if (!moved) {
      // Approved, denied or released while PayPal was answering. The fresh hold belongs to nothing: release it.
      await event(db, p.id, "reauth_released", { to: fresh.authorizationId });
      try {
        await paypal.voidAuthorization(fresh.authorizationId);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[spotter] releasing the spare reauthorization ${fresh.authorizationId} for ${p.id} failed: ${error}`);
        await event(db, p.id, "failed", { step: "release_reauthorization", error });
      }
      continue;
    }
    await event(db, p.id, "reauthorized", { from, to: fresh.authorizationId, ...(fresh.expiresAt ? { expires: fresh.expiresAt } : {}) });
    renewed++;
  }
  return renewed;
}
