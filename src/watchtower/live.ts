// Keeps an open Watchtower current. The page asks every 15 seconds "anything since <time>?"; when a payment
// or a PayPal event changed, it gets the family's board data again plus a few plain notices to show.
import type { Db } from "@/db";
import { getHousehold } from "@/core/households";
import { householdFrom } from "@/server/auth";
import { money } from "@/ui/format";
import { loadPaypal, loadWatchtower } from "./load";

const MAX_NOTICES = 3;

type Changed = { id: string; status: string; amount: string | number; payee: string; who: string };

function notice(p: Changed): string | null {
  const amount = money(Number(p.amount), "GBP");
  switch (p.status) {
    case "captured":
      return `PayPal confirmed ${amount} paid to ${p.payee}`;
    case "voided":
      return `PayPal confirmed ${amount} released`;
    case "needs_approval":
      return `${p.who}'s ${amount} is waiting for you`;
    case "blocked":
      return `Spotter stopped ${amount} for ${p.who}`;
    case "protected":
      return `${p.who}'s ${amount} went as a protected PayPal payment`;
    default:
      return null;
  }
}

export function makeLive(db: Db) {
  return async (request: Request): Promise<Response> => {
    const hh = householdFrom(request);
    if (!hh) return Response.json({ error: "Sign in first." }, { status: 401 });
    const raw = new URL(request.url).searchParams.get("since") ?? "";
    const since = new Date(raw);
    if (!raw || !Number.isFinite(since.getTime())) return Response.json({ error: "Say since when, as a time." }, { status: 400 });
    const now = new Date();

    const changed = await db.query<Changed>(
      `select p.id, p.status, p.amount, p.request->'payee'->>'name' as payee, s.name as who
       from payments p join spenders s on s.id = p.spender_id
       where s.household_id = $1 and p.updated_at > $2 order by p.updated_at desc limit 20`,
      [hh, since.toISOString()],
    );
    const events = ((await loadPaypal(db, hh)) ?? []).filter((e) => e.when.getTime() > since.getTime());
    if (!changed.length && !events.length) return Response.json({ changed: false, now: now.toISOString() });

    const household = await getHousehold(db, hh);
    if (!household) return Response.json({ error: "Sign in first." }, { status: 401 });
    const data = await loadWatchtower(db, household, now);
    const notices = [
      ...events.map((e) => (e.amount ? `${e.label} ${money(Math.round(e.amount * 100), "GBP")}` : e.label)),
      ...changed.map(notice).filter((n): n is string => n !== null),
    ].slice(0, MAX_NOTICES);
    return Response.json({ changed: true, now: now.toISOString(), ...data, notices });
  };
}
