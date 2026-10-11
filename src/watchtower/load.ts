// Everything Watchtower shows for one family, loaded on the server: the page uses it on first load and
// the live route sends it again when something changed. Other families appear only as counts.
import type { Db } from "@/db";
import type { Household } from "@/core/households";
import { listSpenders } from "@/core/households";
import { listPayments } from "@/core/lifecycle";
import { networkCount } from "@/core/network";
import { holdEndsAt, safeTz, whenText } from "@/core/holdtime";
import { SIGN_LABEL, toPaypalRows, toSources, toWatchRows, watchAlerts, type CaseNote, type PaypalRow, type Sources, type WatchAlert } from "./data";
import { listWatches } from "@/core/watch";
import { SAMPLE_NETWORK, sampleMonth, sampleWatches } from "./sample";
import { radarKey, type RadarCount } from "./widgetLogic";

export type WatchtowerData = { sources: Sources; alerts: WatchAlert[]; notes: CaseNote[]; radar: Record<string, RadarCount>; sampleIds: string[] };

const MAX_RADAR_PAYEES = 40;

// Once we know the table isn't there, stop asking (and warning) on every 15 second poll.
const missing = new WeakSet<Db>();

/** PayPal's events for this family, or null when there's no paypal_events table (yet). */
export async function loadPaypal(db: Db, householdId: string): Promise<PaypalRow[] | null> {
  if (missing.has(db)) return null;
  try {
    const rows = await db.query(
      `select e.*, p.amount as payment_amount from paypal_events e
       join payments p on p.id = e.payment_id join spenders s on s.id = p.spender_id
       where s.household_id = $1 order by e.received_at desc limit 1000`,
      [householdId],
    );
    return toPaypalRows(rows).sort((a, b) => b.when.getTime() - a.when.getTime());
  } catch (e) {
    // Only a missing paypal_events table means "no PayPal source". Anything else is a real failure.
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string } | null)?.code;
    if ((code === "42P01" || code === undefined) && /relation "paypal_events" does not exist/i.test(msg)) {
      missing.add(db);
      console.warn("[watchtower] no PayPal source on the board: there's no paypal_events table yet");
      return null;
    }
    throw e;
  }
}

// demo: a demo family's counts are other demo families only (networkCount), and the words say so (networkLine).
async function radarCounts(db: Db, householdId: string, demo: boolean, rows: Sources["payments"]): Promise<Record<string, RadarCount>> {
  const payees = new Map<string, { payee: string; sample: boolean }>();
  for (const r of rows) {
    if (r.outcome !== "Stopped" && r.outcome !== "Denied") continue;
    const key = radarKey(r.payee);
    if (!payees.has(key)) payees.set(key, { payee: r.payee, sample: r.sample === "Yes" });
  }
  const out: Record<string, RadarCount> = {};
  await Promise.all(
    [...payees.entries()].slice(0, MAX_RADAR_PAYEES).map(async ([key, { payee, sample }]) => {
      if (sample) out[key] = { families: SAMPLE_NETWORK[key] ?? 0, sample: true, demo };
      else {
        const n = await networkCount(db, payee, householdId);
        out[key] = { families: n.families, demo: n.demo };
      }
    }),
  );
  return out;
}

export async function loadWatchtower(db: Db, household: Household, now = new Date()): Promise<WatchtowerData> {
  const spenders = await listSpenders(db, household.id);
  const real = await listPayments(db, household.id, 500);
  // Demo families get a labelled sample month so there's something to explore. Real families never do.
  const sample = household.demo ? sampleMonth(spenders, now) : [];
  const payments = [...real, ...sample];
  // Price watches: the family's own (the demo family's example is labelled in the row), plus a sample one for demos.
  const watches = toWatchRows([...(await listWatches(db, household.id, 50)), ...(household.demo ? sampleWatches(spenders, now) : [])]);
  const sources = { ...toSources(payments, spenders, now), watches };
  const [paypal, radar] = await Promise.all([loadPaypal(db, household.id), radarCounts(db, household.id, household.demo === true, sources.payments)]);
  const tz = safeTz(household.time_zone);
  const notes: CaseNote[] = payments.map((p) => ({
    id: p.id,
    reasons: p.decision?.reasons ?? [],
    signs: (p.decision?.flags ?? p.ai?.flags ?? []).map((f) => ({ sign: SIGN_LABEL[f.kind], severity: f.severity, why: f.why })),
    ...(p.case_file ? { caseHeadline: p.case_file.headline, caseFindings: p.case_file.findings.map((f) => f.text) } : {}),
    ...(p.status === "needs_approval"
      ? {
          wait: {
            holdEnds: whenText(holdEndsAt(p), tz),
            holdEndsAt: holdEndsAt(p).toISOString(),
            tz,
            ...(p.ask_again_at ? { askAgain: whenText(new Date(p.ask_again_at), tz), askAgainAt: new Date(p.ask_again_at).toISOString() } : {}),
          },
        }
      : {}),
  }));
  return {
    sources: paypal ? { ...sources, paypal } : sources,
    alerts: watchAlerts(sources.payments, now),
    notes,
    radar,
    sampleIds: sample.map((p) => p.id),
  };
}
