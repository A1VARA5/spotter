// The sums and words behind Spotter's signature widgets, kept out of React so they can be tested.

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** PayPal keeps an authorisation for about three days before the honour period ends. */
const PAYPAL_HOLD = 3 * DAY;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type Countdown = { text: string; about: boolean; expired: boolean; elapsed: number };

/** How long PayPal will keep holding the money. Without PayPal's own expiry, a labelled guess. */
export function countdown(expires: Date | null, heldSince: Date, now: Date): Countdown {
  const about = !expires;
  const end = expires ?? new Date(heldSince.getTime() + PAYPAL_HOLD);
  const left = end.getTime() - now.getTime();
  const total = Math.max(end.getTime() - heldSince.getTime(), 1);
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - heldSince.getTime()) / total));
  if (left <= 0) return { text: "PayPal's hold has run out", about, expired: true, elapsed: 1 };
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / 60_000);
  const parts = days > 0 ? [plural(days, "day"), hours ? plural(hours, "hour") : ""] : hours > 0 ? [plural(hours, "hour"), minutes ? plural(minutes, "minute") : ""] : [plural(Math.max(minutes, 1), "minute")];
  return { text: `expires in ${about ? "about " : ""}${parts.filter(Boolean).join(" ")}`, about, expired: false, elapsed };
}

export const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

export type ReplayRow = { when: Date; amount: number; outcome: string; who: string; payee: string };
export type ReplayDay = { date: Date; kept: number; gone: number; protectedSoFar: number; events: Array<Omit<ReplayRow, "when">> };

const STEPPED_IN = new Set(["Stopped", "Denied", "Protected"]);
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The month replayed a day at a time. "Kept" is money Spotter stopped or the spotter denied. "Gone" is
 * what would have left without Spotter: that, plus payments it switched to buyer protection.
 */
export function replayDays(rows: ReplayRow[], now: Date): ReplayDay[] {
  if (!rows.length) return [];
  const startOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = startOf(now);
  const first = Math.max(Math.min(...rows.map((r) => startOf(r.when))), today - 30 * DAY);
  const days: ReplayDay[] = [];
  let kept = 0;
  let gone = 0;
  let prot = 0;
  for (let t = first; t <= today; t += DAY) {
    const events = rows
      .filter((r) => STEPPED_IN.has(r.outcome) && startOf(r.when) === t)
      .sort((a, b) => a.when.getTime() - b.when.getTime())
      .map(({ amount, outcome, who, payee }) => ({ amount, outcome, who, payee }));
    for (const e of events) {
      gone += e.amount;
      if (e.outcome === "Protected") prot += e.amount;
      else kept += e.amount;
    }
    days.push({ date: new Date(t), kept: round(kept), gone: round(gone), protectedSoFar: round(prot), events });
  }
  return days;
}

const ATTENTION = ["Stopped", "Denied", "Waiting", "Protected"];

/** Which payment a case file shows: the newest one Spotter stepped in on, else the newest. */
export function pickCase(rows: Array<{ id: string; when: Date; outcome: string }>): string | null {
  const newest = [...rows].sort((a, b) => b.when.getTime() - a.when.getTime());
  return (newest.find((r) => ATTENTION.includes(r.outcome)) ?? newest[0])?.id ?? null;
}

export type RadarCount = { families: number; sample?: boolean };
export type RadarLine = { payee: string; families: number; sample: boolean; text: string };
export const radarKey = (payee: string) => payee.trim().toLowerCase();

/** The family's stopped or denied payees, with how many other families' spotters said no to them. */
export function radarLines(rows: Array<{ payee: string; outcome: string }>, counts: Record<string, RadarCount>): RadarLine[] {
  const seen = new Map<string, string>();
  for (const r of rows) if ((r.outcome === "Stopped" || r.outcome === "Denied") && !seen.has(radarKey(r.payee))) seen.set(radarKey(r.payee), r.payee.trim());
  return [...seen.entries()]
    .map(([key, payee]) => {
      const c = counts[key];
      const families = c?.families ?? 0;
      return {
        payee,
        families,
        sample: c?.sample ?? false,
        text: families ? `Stopped for ${families} other ${families === 1 ? "family" : "families"} in the last 30 days` : "No other Spotter family has reported it yet",
      };
    })
    .sort((a, b) => b.families - a.families || a.payee.localeCompare(b.payee));
}
