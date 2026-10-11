// Watchtower's data: payments turned into flat tables AG Studio (and its AI agents) can read, and the
// watch alerts, which code works out from those rows. The model never decides what counts as an alert.
// The untrusted text a payment came with (the scam message, the shop page) is left out on purpose:
// the agents only see names, amounts, outcomes and Spotter's own findings.
import type { Payment, Spender } from "@/core/lifecycle";
import type { FlagKind, Severity } from "@/core/grounding";
import { money, trackState } from "@/ui/format";

export type PaymentRow = {
  id: string;
  when: Date;
  who: string;
  kind: string;
  payee: string;
  category: string;
  method: string;
  amount: number;
  outcome: string;
  moneyKept: number;
  signs: number;
  topSign: string;
  verdict: string;
  newPayee: "Yes" | "No";
  sample: "Yes" | "No";
  /** Pounds sitting in a PayPal authorisation right now (a Waiting payment), else 0. */
  heldAtPayPal: number;
  /** When PayPal's authorisation runs out, for held money. Null when not held or not known yet. */
  paypalExpires: Date | null;
  /** PayPal's authorisation id (or order id before there is one). */
  paypalId: string;
  /** The cheapest real retailer price Channel3 found for the item, in pounds. Null when there was no usable price check. */
  marketCheapest: number | null;
  /** The median real retailer price, in pounds. Null when there was no usable price check. */
  marketMedian: number | null;
  /** What was paid minus the cheapest real retailer: positive is overpaid, negative is saved. */
  priceGap: number | null;
  /** The cheapest retailer's domain. */
  marketShop: string;
  /** The item that was price checked. */
  marketItem: string;
  /** "Was it you?": who the message claimed to be, whether Spotter asked them and what they said. */
  wasItYou: string;
};
/** Spotter's own words about one payment, for the case file widget and the open_case_file tool. */
export type CaseNote = { id: string; reasons: string[]; signs: Array<{ sign: string; severity: string; why: string }>; caseHeadline?: string; caseFindings?: string[] };
/** One thing PayPal told us about a payment (a webhook or a status check). */
export type PaypalRow = { id: string; when: Date; eventType: string; label: string; paymentId: string; amount: number };
export type SignRow = { paymentId: string; when: Date; who: string; payee: string; sign: string; severity: string };
export type PersonRow = { name: string; kind: string; weeklyAllowance: number; spentThisWeek: number };
export type Sources = { payments: PaymentRow[]; signs: SignRow[]; people: PersonRow[]; paypal?: PaypalRow[] };

export const SIGN_LABEL: Record<FlagKind, string> = {
  pressure: "Pressure to hurry",
  impersonation: "Pretending to be someone",
  friends_and_family: "Asks for Friends and Family",
  gift_card_or_crypto: "Gift cards or crypto",
  prompt_injection: "Hidden instructions for AI",
  price: "Price looks wrong",
  new_shop: "Brand new shop",
  changed_bank_details: "Bank details changed",
  other: "Something else odd",
};
const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };
const KIND_LABEL: Record<string, string> = { agent: "AI agent", person: "Person", kid: "Kid" };
const METHOD_LABEL: Record<string, string> = {
  paypal_order: "PayPal",
  friends_and_family: "Friends and Family",
  gift_card: "Gift card",
  crypto: "Crypto",
  bank_transfer: "Bank transfer",
  other: "Other",
};
const OUTCOME: Record<ReturnType<typeof trackState>, string> = {
  checking: "Checking",
  moving: "Paying",
  held: "Waiting",
  paid: "Paid",
  blocked: "Stopped",
  protected: "Protected",
  returned: "Denied",
  failed: "Failed",
};
export const OUTCOME_ORDER = ["Stopped", "Denied", "Waiting", "Protected", "Paid"];
const VERDICT: Record<string, string> = { likely_scam: "Likely scam", unclear: "Unclear", looks_fine: "Looks fine" };

/** Payments that came from the labelled sample month carry this marker on their id. */
export const SAMPLE_PREFIX = "pay_sample_";

const pounds = (minor: string | number) => Number(minor) / 100;
const flagsOf = (p: Payment) => p.decision?.flags ?? p.ai?.flags ?? [];

function wasItYouWords(p: Payment): string {
  const w = p.was_it_you;
  if (!w) return "Not asked";
  const who = w.who;
  return { asked: `Asked ${who}`, not_me: `${who}: not me`, it_was_me: `${who}: it was me`, no_channel: `${who} not linked`, send_failed: `Couldn't reach ${who}` }[w.state];
}

export function toSources(payments: Payment[], spenders: Spender[], now = new Date()): Sources {
  const byId = new Map(spenders.map((s) => [s.id, s]));
  const rows: PaymentRow[] = [];
  const signs: SignRow[] = [];
  for (const p of payments) {
    const who = byId.get(p.spender_id);
    const outcome = OUTCOME[trackState(p.status)];
    const amount = pounds(p.amount);
    const flags = flagsOf(p);
    const when = new Date(p.created_at);
    // Set by the PayPal reconciler once it has asked PayPal; older rows don't have the column at all.
    const expiresRaw = (p as Payment & { paypal_auth_expires_at?: string | Date | null }).paypal_auth_expires_at;
    const expires = outcome === "Waiting" && expiresRaw ? new Date(expiresRaw) : null;
    // A price check only counts with a cheapest offer and a median, i.e. at least two real retailers.
    const m = p.market?.cheapest && p.market.median ? p.market : null;
    const cheapest = m ? pounds(m.cheapest!.price) : null;
    rows.push({
      id: p.id,
      when,
      who: who?.name ?? "Someone",
      kind: KIND_LABEL[who?.kind ?? ""] ?? "Person",
      payee: p.request.payee.name,
      category: p.request.category,
      method: METHOD_LABEL[p.request.method] ?? "Other",
      amount,
      outcome,
      moneyKept: outcome === "Stopped" || outcome === "Denied" ? amount : 0,
      signs: flags.length,
      topSign: flags[0] ? SIGN_LABEL[flags[0].kind] : "None",
      verdict: p.case_file ? (VERDICT[p.case_file.verdict] ?? "None") : "None",
      newPayee: p.request.payee.isNew ? "Yes" : "No",
      sample: p.id.startsWith(SAMPLE_PREFIX) ? "Yes" : "No",
      heldAtPayPal: outcome === "Waiting" ? amount : 0,
      paypalExpires: expires && Number.isFinite(expires.getTime()) ? expires : null,
      paypalId: p.paypal_authorization_id ?? p.paypal_order_id ?? "",
      marketCheapest: cheapest,
      marketMedian: m ? pounds(m.median!) : null,
      priceGap: cheapest === null ? null : Math.round((amount - cheapest) * 100) / 100,
      marketShop: m?.cheapest?.domain ?? "",
      marketItem: m?.item ?? "",
      wasItYou: wasItYouWords(p),
    });
    for (const f of flags) {
      signs.push({ paymentId: p.id, when, who: who?.name ?? "Someone", payee: p.request.payee.name, sign: SIGN_LABEL[f.kind], severity: SEVERITY_LABEL[f.severity] });
    }
  }
  // Studio colours chart series in the order values first appear, and has no per value colours. Worst
  // outcomes first means Stopped always gets the palette's red and Paid its green.
  const rank = (o: string) => {
    const i = OUTCOME_ORDER.indexOf(o);
    return i === -1 ? OUTCOME_ORDER.length : i;
  };
  rows.sort((a, b) => rank(a.outcome) - rank(b.outcome) || b.when.getTime() - a.when.getTime());
  const weekAgo = now.getTime() - 7 * 24 * 3600_000;
  const people = spenders.map((s) => ({
    name: s.name,
    kind: KIND_LABEL[s.kind] ?? "Person",
    weeklyAllowance: pounds(s.allowance.weekly.amount),
    // Money that actually reached a payee in the last 7 days.
    spentThisWeek: rows.filter((r) => r.who === s.name && r.outcome === "Paid" && r.when.getTime() > weekAgo).reduce((t, r) => t + r.amount, 0),
  }));
  return { payments: rows, signs, people };
}

export type WatchAlert = {
  id: string;
  kind: "spike" | "repeat_payee" | "waiting" | "new_sign";
  level: "high" | "medium";
  title: string;
  detail: string;
  who: string;
  paymentIds: string[];
};

const HOUR = 3600_000;
const listNames = (names: string[]) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What the spotter should look at, worked out by code from the rows. Highest first. */
export function watchAlerts(rows: PaymentRow[], now = new Date()): WatchAlert[] {
  const t = now.getTime();
  const alerts: WatchAlert[] = [];
  const troubled = (r: PaymentRow) => r.outcome === "Stopped" || r.outcome === "Waiting" || r.outcome === "Denied";

  // A run of holds or stops for one person in the last day.
  const lastDay = rows.filter((r) => troubled(r) && t - r.when.getTime() < 24 * HOUR);
  for (const who of new Set(lastDay.map((r) => r.who))) {
    const mine = lastDay.filter((r) => r.who === who);
    if (mine.length < 2) continue;
    alerts.push({
      id: `spike:${who}`,
      kind: "spike",
      level: "high",
      title: `${who} had ${mine.length} payments held or stopped today`,
      detail: "Someone may be working on them. A quick call is worth it.",
      who,
      paymentIds: mine.map((r) => r.id),
    });
  }

  // One payee stopped or denied for more than one person this month.
  const blockedRecent = rows.filter((r) => (r.outcome === "Stopped" || r.outcome === "Denied") && t - r.when.getTime() < 30 * 24 * HOUR);
  const byPayee = new Map<string, PaymentRow[]>();
  for (const r of blockedRecent) byPayee.set(r.payee.trim().toLowerCase(), [...(byPayee.get(r.payee.trim().toLowerCase()) ?? []), r]);
  for (const group of byPayee.values()) {
    const people = [...new Set(group.map((r) => r.who))];
    if (people.length < 2) continue;
    alerts.push({
      id: `payee:${group[0]!.payee.toLowerCase()}`,
      kind: "repeat_payee",
      level: "high",
      title: `${group[0]!.payee} was stopped for ${listNames(people)}`,
      detail: "The same payee is going after more than one person in your family.",
      who: people.join(", "),
      paymentIds: group.map((r) => r.id),
    });
  }

  // Held payments left waiting.
  for (const r of rows) {
    const hours = Math.floor((t - r.when.getTime()) / HOUR);
    if (r.outcome !== "Waiting" || hours < 12) continue;
    alerts.push({
      id: `waiting:${r.id}`,
      kind: "waiting",
      level: "medium",
      title: `${r.who}'s ${money(Math.round(r.amount * 100), "GBP")} has waited ${hours} hours for you`,
      detail: "The money is on hold. Approve or deny it so they're not left wondering.",
      who: r.who,
      paymentIds: [r.id],
    });
  }

  // A kind of scam sign showing up this week that wasn't seen in the 3 weeks before. Only meaningful
  // when there is history older than a week to compare with.
  const week = rows.filter((r) => r.signs > 0 && t - r.when.getTime() < 7 * 24 * HOUR);
  const before = rows.filter((r) => t - r.when.getTime() >= 7 * 24 * HOUR && t - r.when.getTime() < 30 * 24 * HOUR);
  if (before.length > 0) {
    const seen = new Set(before.filter((r) => r.signs > 0).map((r) => r.topSign));
    for (const sign of new Set(week.map((r) => r.topSign))) {
      if (seen.has(sign)) continue;
      const mine = week.filter((r) => r.topSign === sign);
      alerts.push({
        id: `sign:${sign}`,
        kind: "new_sign",
        level: "medium",
        title: `New this week: ${sign.charAt(0).toLowerCase()}${sign.slice(1)}`,
        detail: `Spotter hadn't seen this kind of trick in your family for a month. It came up for ${listNames([...new Set(mine.map((r) => r.who))])}.`,
        who: [...new Set(mine.map((r) => r.who))].join(", "),
        paymentIds: mine.map((r) => r.id),
      });
    }
  }

  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
}

const PAYPAL_LABEL: Record<string, string> = {
  "CHECKOUT.ORDER.APPROVED": "Order approved at PayPal",
  "CHECKOUT.ORDER.COMPLETED": "PayPal completed the order",
  "PAYMENT.AUTHORIZATION.CREATED": "PayPal is holding the money",
  "PAYMENT.AUTHORIZATION.VOIDED": "PayPal released the hold",
  "PAYMENT.CAPTURE.COMPLETED": "PayPal captured",
  "PAYMENT.CAPTURE.PENDING": "PayPal capture pending",
  "PAYMENT.CAPTURE.DENIED": "PayPal declined the capture",
  "PAYMENT.CAPTURE.REFUNDED": "PayPal refunded",
  "PAYMENT.CAPTURE.REVERSED": "PayPal reversed the payment",
};

/**
 * Rows from the paypal_events table, in whatever shape it has (webhooks carry PayPal's resource, status
 * checks may not), turned into plain words. Rows without a usable date are left out.
 */
export function toPaypalRows(events: Array<Record<string, unknown>>): PaypalRow[] {
  const out: PaypalRow[] = [];
  for (const e of events) {
    const at = e.created_at ?? e.received_at ?? e.at;
    const when = at instanceof Date ? at : typeof at === "string" ? new Date(at) : null;
    if (!when || !Number.isFinite(when.getTime())) continue;
    const eventType = String(e.event_type ?? e.type ?? "");
    const nested = (k: string) => (e[k] as { resource?: unknown } | null | undefined)?.resource;
    const resource = (e.resource ?? nested("data") ?? nested("payload")) as { amount?: { value?: string } } | undefined;
    // The webhook stores PayPal's amount in summary.amount; older shapes carried the whole resource.
    const summary = e.summary as { amount?: unknown } | null | undefined;
    const raw = summary?.amount ?? resource?.amount?.value;
    const fromEvent = raw == null ? NaN : Number(raw);
    const fromPayment = e.payment_amount == null ? NaN : Number(e.payment_amount) / 100;
    const amount = Number.isFinite(fromEvent) ? fromEvent : Number.isFinite(fromPayment) ? fromPayment : 0;
    const plain = eventType.toLowerCase().replace(/[._]+/g, " ").trim();
    out.push({
      id: String(e.id ?? ""),
      when,
      eventType,
      label: PAYPAL_LABEL[eventType] ?? (plain ? `PayPal: ${plain}` : "PayPal update"),
      paymentId: e.payment_id == null ? "" : String(e.payment_id),
      amount,
    });
  }
  return out;
}
