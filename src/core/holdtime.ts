// Hold times for "sleep on it", kept free of server code so the dashboard and the simple view can show them too.
// PayPal facts (docs/paypal-notes.md): funds are guaranteed for a 3 day honor period, a hold expires 29 days after it was made.
import type { Payment } from "./lifecycle";
import { formatMoney, type Currency } from "./types";

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
export const HONOR_DAYS = 3;
export const HOLD_DAYS = 29;
/** Reauthorizing a hold that ends within a day buys nothing; it is left to end. */
export const LAST_REAUTH_DAY = 28;
export const DEFAULT_TZ = "Europe/London";

export function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** The wall clock in a time zone, as numbers. */
function wall(t: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), min: n("minute"), s: n("second") };
}

/** How far a time zone is ahead of UTC at a moment, in ms. */
function offset(t: number, tz: string) {
  const w = wall(t, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t / 1000) * 1000;
}

/** 9am on the next calendar day where the household lives (clock changes included). */
export function nextNineAm(now: Date, tz: string): Date {
  const zone = safeTz(tz);
  const today = wall(now.getTime(), zone);
  const target = Date.UTC(today.y, today.m - 1, today.d + 1, 9, 0, 0);
  let t = target - offset(target, zone);
  t = target - offset(t, zone); // once more, in case the clocks change between the guess and 9am
  return new Date(t);
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Wednesday 4 November at 9am", in the household's time. */
export function whenText(at: Date, tz: string): string {
  const w = wall(at.getTime(), safeTz(tz));
  const dow = DAYS[new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay()];
  const h12 = w.h % 12 === 0 ? 12 : w.h % 12;
  const time = `${h12}${w.min ? `:${String(w.min).padStart(2, "0")}` : ""}${w.h < 12 ? "am" : "pm"}`;
  return `${dow} ${w.d} ${MONTHS[w.m - 1]} at ${time}`;
}

/** The morning "ask again" after someone chose to sleep on a held payment: alerts say so in their first line. */
export const askingAgain = (p: Pick<Payment, "status" | "sleeps" | "ask_again_at">) => p.status === "needs_approval" && (p.sleeps ?? 0) > 0 && !p.ask_again_at;

export const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

/** When PayPal lets the hold go if nobody approves: its own expiry when we know it, else 29 days after the hold. */
export function holdEndsAt(p: Pick<Payment, "created_at" | "paypal_auth_expires_at">): Date {
  if (p.paypal_auth_expires_at) {
    const d = asDate(p.paypal_auth_expires_at);
    if (Number.isFinite(d.getTime())) return d;
  }
  return new Date(asDate(p.created_at).getTime() + HOLD_DAYS * DAY);
}

/** Said plainly on every held payment: the hold ends on its own, the money goes back, nothing is paid by itself. */
export function holdEndLine(p: Pick<Payment, "created_at" | "paypal_auth_expires_at" | "amount" | "currency">, who: string, tz: string): string {
  const amount = formatMoney({ amount: Number(p.amount), currency: p.currency as Currency });
  return `If nobody approves by ${whenText(holdEndsAt(p), tz)}, PayPal lets the hold go and the ${amount} goes back to ${who}. Spotter never pays it on its own.`;
}
