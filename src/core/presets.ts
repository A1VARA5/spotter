// Starting points for the people a spotter looks out for. Every number can be changed afterwards.
import type { SpenderKind } from "./lifecycle";
import type { Allowance } from "./types";
import type { HouseholdKind } from "./households";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });

export type PresetKey = "relative" | "kid" | "agent" | "staff" | "buyer";
export type Preset = { label: string; hint: string; kind: SpenderKind; allowance: Omit<Allowance, "spentThisWeek"> };

export const PRESETS: Record<PresetKey, Preset> = {
  relative: {
    label: "A parent or relative",
    hint: "Ordinary payments go through. Anything big, new or pushy waits for you.",
    kind: "person",
    allowance: { weekly: gbp(30000), askAbove: gbp(5000), blockedCategories: ["gift_cards", "crypto"], allowedPayees: [], blockedPayees: [] },
  },
  kid: {
    label: "A kid",
    hint: "Pocket money sized. No gambling, crypto or gift card codes.",
    kind: "kid",
    allowance: { weekly: gbp(1000), askAbove: gbp(500), blockedCategories: ["gambling", "crypto", "gift_cards"], allowedPayees: [], blockedPayees: [] },
  },
  agent: {
    label: "An AI agent",
    hint: "Shops for you through Spotter's tools. It can ask to pay, never approve itself.",
    kind: "agent",
    allowance: { weekly: gbp(40000), askAbove: gbp(3000), blockedCategories: ["gift_cards", "crypto", "gambling"], allowedPayees: [], blockedPayees: [] },
  },
  // Small business: same rules engine, business sized numbers. New suppliers always ask (the new payee rule).
  staff: {
    label: "Someone on my staff",
    hint: "Pays suppliers and bills. Anything over £250, any new supplier, or anything pushy waits for you.",
    kind: "person",
    allowance: { weekly: gbp(300000), askAbove: gbp(25000), blockedCategories: ["gift_cards", "crypto"], allowedPayees: [], blockedPayees: [] },
  },
  buyer: {
    label: "An AI buying agent",
    hint: "Reorders stock and supplies through Spotter's tools. It can ask to pay, never approve itself.",
    kind: "agent",
    allowance: { weekly: gbp(200000), askAbove: gbp(25000), blockedCategories: ["gift_cards", "crypto"], allowedPayees: [], blockedPayees: [] },
  },
};

const FOR_KIND: Record<HouseholdKind, PresetKey[]> = { family: ["relative", "kid", "agent"], business: ["staff", "buyer"] };

/** The presets offered to this kind of household, in the order setup shows them. */
export function presetsFor(kind: HouseholdKind): Partial<Record<PresetKey, Preset>> {
  return Object.fromEntries(FOR_KIND[kind].map((k) => [k, PRESETS[k]]));
}
