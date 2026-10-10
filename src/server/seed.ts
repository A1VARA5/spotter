// The demo family: an AI shopping agent, Gran, and a kid. Amounts in pence. Ids are made per household.
// Weekly allowances are big on purpose so every Try a payment scenario keeps its promised outcome in any order;
// the ask me limits are the real presets, so every big payment still waits for the spotter.
import type { NewSpender } from "@/core/lifecycle";

type SpenderSeed = Omit<NewSpender, "id" | "householdId" | "spotterName">;
const gbp = (amount: number) => ({ amount, currency: "GBP" as const });

export const DEMO_SPOTTER = "Sam";
export const DEMO_PIN = "2468";

export const DEMO_SPENDERS: SpenderSeed[] = [
  {
    name: "Shopping agent",
    kind: "agent",
    allowance: { weekly: gbp(100000), askAbove: gbp(3000), blockedCategories: ["gift_cards", "crypto", "gambling"], allowedPayees: ["Greenway Grocers", "Clay & Kiln"], blockedPayees: [] },
  },
  {
    name: "Gran",
    kind: "person",
    allowance: { weekly: gbp(120000), askAbove: gbp(5000), blockedCategories: ["gift_cards", "crypto"], allowedPayees: ["Hillside Pharmacy"], blockedPayees: [] },
  },
  {
    name: "Leo",
    kind: "kid",
    allowance: { weekly: gbp(1000), askAbove: gbp(500), blockedCategories: ["gambling", "crypto"], allowedPayees: [], blockedPayees: [] },
  },
];
