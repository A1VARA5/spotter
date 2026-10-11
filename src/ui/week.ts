// What Spotter did in the last 7 days, for the dashboard when nothing is waiting. Pure, so the server's first
// render and the browser's agree when given the same clock.
import type { Payment } from "@/core/lifecycle";

export type WeekSummary = {
  checked: number;
  paid: number;
  stopped: number;
  waiting: number;
  /** Money stopped before it moved (stopped, refused or released holds), per currency, largest first. */
  kept: Array<{ currency: string; amount: number }>;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PAID = new Set(["captured", "capturing", "authorised"]);
const STOPPED = new Set(["blocked", "protected", "voided", "voiding"]);

type Row = Pick<Payment, "status" | "amount" | "currency" | "created_at"> & { case_file?: { example?: boolean } | null };

export function weekSummary(payments: Row[], now: number): WeekSummary {
  // The demo's example hold is labelled "checked earlier", not something Spotter did this week.
  const week = payments.filter((p) => !p.case_file?.example && now - new Date(p.created_at).getTime() <= WEEK_MS);
  const kept = new Map<string, number>();
  for (const p of week) if (STOPPED.has(p.status)) kept.set(p.currency, (kept.get(p.currency) ?? 0) + Number(p.amount));
  return {
    checked: week.length,
    paid: week.filter((p) => PAID.has(p.status)).length,
    stopped: week.filter((p) => STOPPED.has(p.status)).length,
    waiting: week.filter((p) => p.status === "needs_approval").length,
    kept: [...kept].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount),
  };
}
