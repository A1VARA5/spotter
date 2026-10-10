// The few words that change for a small business. Same screens, same code path; families read as before.
import type { HouseholdKind } from "@/core/households";

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
