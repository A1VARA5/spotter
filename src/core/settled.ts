// What happened to a payment once it was decided, in the past tense. A case file is written while the money is held
// ("PayPal is holding the money, so nothing has been paid yet"); once it is paid, denied, stopped or released, the
// case file, the Activity drawer and the evidence pack read their PayPal facts from here instead, so none of them can
// still say the money is held. Pure, so the screens and the server agree.
import type { Case } from "@/agents/case";
import { formatMoney, type Currency } from "./types";
import { CAPTURED_WHILE_RELEASING, LAPSED_HOLD, LATE_BY, LATE_HOLD, PAUSED_BY } from "./decidedBy";
import { tripOutcome, type PaymentTrip } from "./tripped";

export type SettledInput = {
  status: string;
  decided_by: string | null;
  error: string | null;
  amount: number | string;
  currency: string;
  request: { payee: { name: string } };
  was_it_you?: { state: string; who: string; channel?: string | null } | null;
  tripwire?: PaymentTrip | null;
};

export type Settled =
  | "paid"
  | "paid_anyway"
  | "paid_by_rules"
  | "paying"
  | "denied"
  | "not_me"
  | "releasing"
  | "paused"
  | "late"
  | "lapsed"
  | "released"
  | "stopped"
  | "not_sent"
  | "failed";

/** "Spotter (the lab run ended)": a hold Spotter let go on its own, and why. */
const BY_SPOTTER = /^Spotter \((.{1,80})\)$/;

/** Which ending this payment had, or null while nothing is decided yet (checking, waiting for the spotter). */
export function settledAs(p: SettledInput): Settled | null {
  switch (p.status) {
    case "captured":
      // PayPal took it while Spotter was letting it go: decided_by is whoever said no, so never "approved by" them.
      if (p.error === CAPTURED_WHILE_RELEASING) return "paid_anyway";
      return !p.decided_by || p.decided_by === "Spotter" ? "paid_by_rules" : "paid";
    case "capturing":
      return "paying";
    case "voiding":
      return "releasing";
    case "voided":
      if (p.decided_by === LATE_BY || p.error === LATE_HOLD) return "late";
      if (p.error === LAPSED_HOLD) return "lapsed";
      if (p.decided_by === PAUSED_BY) return "paused";
      if (p.was_it_you?.state === "not_me" && p.decided_by === p.was_it_you.who) return "not_me";
      if (!p.decided_by || BY_SPOTTER.test(p.decided_by)) return "released";
      return "denied";
    case "blocked":
      return "stopped";
    case "protected":
      return "not_sent";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/**
 * The status pill for endings nobody pressed Deny on: a tripwire stop, or a Not me from the person the message
 * pretended to be. null: the usual words for the payment's status (src/ui/labels.ts) are right.
 */
export function shownOutcome(p: SettledInput): { state: "blocked" | "returned"; short: string; long: string; explain: string } | null {
  const trip = tripOutcome(p);
  if (trip) return trip;
  if (settledAs(p) !== "not_me") return null;
  // "alert": the message said it was from the spotter, and the spotter answered, so talk to them as "you".
  const who = p.was_it_you?.channel === "alert" ? "you" : p.was_it_you!.who;
  // Short enough for the rail's pill; the Was it you? line under it says PayPal released the hold.
  return { state: "returned", short: "Not me", long: `Not me: ${who} didn't send it`, explain: "PayPal released the hold. Nothing was paid." };
}

const amountOf = (p: SettledInput) => formatMoney({ amount: Number(p.amount), currency: p.currency as Currency });

/** One line saying how it ended, for the top of a decided payment's case file and the Activity drawer. */
export function outcomeLine(p: SettledInput): string | null {
  const s = settledAs(p);
  if (!s) return null;
  const amount = amountOf(p);
  const payee = p.request.payee.name;
  const spotterWhy = p.decided_by ? BY_SPOTTER.exec(p.decided_by)?.[1] : undefined;
  switch (s) {
    case "paid":
      return `Paid. ${p.decided_by} approved it, so PayPal paid ${amount} to ${payee}.`;
    case "paid_by_rules":
      return `Paid. It was within the rules, so PayPal paid ${amount} to ${payee}.`;
    case "paid_anyway":
      return `Paid, although Spotter was letting it go: PayPal took ${amount} for ${payee}. Check it in PayPal.`;
    case "paying":
      return `Approved${p.decided_by && p.decided_by !== "Spotter" ? ` by ${p.decided_by}` : ""}. PayPal is finishing the payment of ${amount} to ${payee}.`;
    case "denied":
      return `Denied. ${p.decided_by} said no, so PayPal released the ${amount}. Nothing was paid.`;
    case "not_me":
      return `Released. ${p.decided_by} said the message wasn't from them, so PayPal released the ${amount}. Nothing was paid.`;
    case "releasing":
      return `Being released. Spotter asked PayPal to let the ${amount} go. Nothing was paid.`;
    case "paused": {
      const t = tripOutcome(p);
      return t ? `${t.long}. ${t.explain} Nothing was paid.` : "Stopped by a tripwire. Spotter froze the agent and PayPal released the hold. Nothing was paid.";
    }
    case "late":
      return LATE_HOLD;
    case "lapsed":
      return `Not paid. The hold ran out before the payment went through, so the ${amount} was never taken.`;
    case "released":
      return `Released. ${spotterWhy ? `Spotter let the hold go (${spotterWhy}).` : `PayPal let the hold go.`} Nothing was paid.`;
    case "stopped":
      return "Stopped. Spotter stopped it before anything reached PayPal. Nothing was paid.";
    case "not_sent":
      return "Not sent. It was asked for in a way that has no buyer protection, so Spotter didn't send it. Nothing was paid.";
    case "failed":
      return `Not paid. ${p.error ?? "PayPal didn't take the payment."}`;
  }
}

/** The PayPal fact in the past tense, in place of the case file's "PayPal is holding the money" line. */
export function holdFact(p: SettledInput): string | null {
  const s = settledAs(p);
  if (!s) return null;
  switch (s) {
    case "paid":
    case "paid_by_rules":
      return `PayPal paid it: the money went to ${p.request.payee.name}.`;
    case "paid_anyway":
      return "PayPal took the money although Spotter was letting the hold go. Check it in PayPal.";
    case "paying":
      return "PayPal is taking the payment now.";
    case "denied":
    case "not_me":
    case "paused":
    case "released":
      return "PayPal released the hold, so nothing was paid.";
    case "releasing":
      return "Spotter asked PayPal to release the hold. Nothing was paid.";
    case "late":
      return LATE_HOLD;
    case "lapsed":
      return "The hold ran out before the payment went through, so nothing was paid.";
    case "stopped":
    case "not_sent":
      return "Nothing reached PayPal, so nothing was held or paid.";
    case "failed":
      return "PayPal didn't take the payment, so nothing was paid.";
  }
}

/**
 * The case file as it reads after the decision: the PayPal hold line says what PayPal did, and the "before you decide"
 * advice goes. A payment that still waits gets the case file back untouched.
 */
export function settledCase(c: Case, p: SettledInput): Case {
  const fact = holdFact(p);
  if (!fact) return c;
  return {
    ...c,
    ask: [],
    findings: c.findings.map((f) => (f.tool === "paypal_hold" ? { ...f, text: fact } : f)),
  };
}
