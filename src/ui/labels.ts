// The few words that change for a small business. Same screens, same code path; families read as before.
import type { HouseholdKind } from "@/core/households";
import type { TrackState } from "./format";

export type Labels = {
  /** Each spender kind as a short tag. */
  kind: Record<string, string>;
  nameSub: string;
  peopleQ: string;
  peopleSub: string;
  /** "Add ... to try this one", per spender kind. */
  addWho: Record<"agent" | "person" | "kid", string>;
  /** The name filled in when an AI agent preset is picked. */
  agentName: string;
};

export const LABELS: Record<HouseholdKind, Labels> = {
  family: {
    kind: { person: "Relative", kid: "Kid", agent: "AI agent" },
    nameSub: "This is the name your people see when a payment waits for you.",
    peopleQ: "Who are you looking out for?",
    peopleSub: "Add everyone whose payments you'd like a second look at. You can add more later.",
    agentName: "Shopping agent",
    addWho: { agent: "an AI agent", person: "a relative", kid: "a kid" },
  },
  business: {
    kind: { person: "Staff", kid: "Kid", agent: "AI buying agent" },
    nameSub: "You're the approver. This is the name your staff and agents see when a payment waits for you.",
    peopleQ: "Who pays suppliers for you?",
    peopleSub: "Add the staff and AI buying agents who pay for things. New suppliers and anything over £250 wait for you.",
    agentName: "Buying agent",
    addWho: { agent: "an AI buying agent", person: "someone on your staff", kid: "a kid" },
  },
};

export const labelsFor = (kind: HouseholdKind | undefined): Labels => LABELS[kind ?? "family"];

// ---------- one vocabulary for what happened to a payment ----------
// Every page says it the same way: the dashboard, Try, Activity, people pages, Watchtower and Gran's view.
// short: chips, chart categories and Watchtower's outcome column. long: status pills and result lines.
// explain: the one plain sentence after it. Held money is "on hold at PayPal" and never counts as spent.
export const OUTCOME_WORDS: Record<TrackState, { short: string; long: string; explain: string }> = {
  checking: { short: "Checking", long: "Checking", explain: "Spotter is looking at it. No money has moved." },
  moving: { short: "Paying", long: "Paying", explain: "Approved. PayPal is paying it now." },
  held: { short: "Waiting", long: "Waiting for you", explain: "PayPal is holding the money until you approve or deny it." },
  paid: { short: "Paid", long: "Paid", explain: "Within the rules, and nothing looked wrong." },
  blocked: { short: "Stopped", long: "Stopped", explain: "Spotter stopped it before any money moved." },
  protected: { short: "Protected", long: "Protected, not sent", explain: "Not sent the unsafe way. Pay with a protected PayPal payment instead." },
  returned: { short: "Denied", long: "Denied, money released", explain: "You said no, so PayPal released the hold. Nothing was paid." },
  failed: { short: "Failed", long: "PayPal said no", explain: "PayPal didn't take the payment. Nothing was paid." },
};

/** Money waiting on a decision, in the same words everywhere. */
export const ON_HOLD = "on hold at PayPal";

/**
 * The warning in the approve confirm. It follows the case file's verdict word for word, so a card that says "Worth a
 * closer look" confirms with "worth a closer look", never "serious warning signs" or "likely a scam". Only a payment
 * with no case file verdict falls back to the check's own serious signs. null: no warning.
 */
export function approveWarning(verdict: string | undefined, highFlag: boolean): string | null {
  const after = "Once PayPal pays, it can't be pulled back.";
  if (verdict === "likely_scam") return `Spotter thinks this is likely a scam. ${after}`;
  if (verdict === "unclear") return `Spotter thinks this is worth a closer look before you pay. ${after}`;
  if (verdict) return null;
  if (highFlag) return `Spotter found serious warning signs. ${after}`;
  return null;
}
