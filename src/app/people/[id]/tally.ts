// What a person page shows for this week: money really spent, and money on hold at PayPal waiting for the
// spotter, apart. The allowance check itself (core weekSpend) still counts holds, so a held payment can't be
// sent twice past the limit; this is only the words on the page.
type Row = { status: string; amount: number | string; currency: string; created_at: string | Date };

const SPENT = new Set(["authorised", "capturing", "captured"]);
const WEEK = 7 * 24 * 3600_000;

export function weekTally(rows: Row[], currency: string, now = Date.now()): { spent: number; onHold: number } {
  let spent = 0;
  let onHold = 0;
  for (const r of rows) {
    if (r.currency !== currency || now - new Date(r.created_at).getTime() > WEEK) continue;
    if (SPENT.has(r.status)) spent += Number(r.amount);
    else if (r.status === "needs_approval") onHold += Number(r.amount);
  }
  return { spent, onHold };
}
