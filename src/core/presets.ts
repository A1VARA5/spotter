// Starting points for the people a spotter looks out for. Every number can be changed afterwards.
import type { SpenderKind } from "./lifecycle";
import type { Allowance } from "./types";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });

export type PresetKey = "relative" | "kid" | "agent";
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
};
