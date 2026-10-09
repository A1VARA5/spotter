// The demo household: an AI shopping agent, Gran, and a kid. Amounts in pence.
import type { createSpender } from "@/core/lifecycle";

type SpenderSeed = Parameters<typeof createSpender>[1];
const gbp = (amount: number) => ({ amount, currency: "GBP" as const });

export const DEMO_SPENDERS: SpenderSeed[] = [
  {
    id: "agent",
    name: "Shopping agent",
    kind: "agent",
    spotterName: "Aivaras",
    allowance: { weekly: gbp(15000), askAbove: gbp(3000), blockedCategories: ["gift_cards", "crypto", "gambling"], allowedPayees: ["Tesco"], blockedPayees: [] },
  },
  {
    id: "gran",
    name: "Gran",
    kind: "person",
    spotterName: "Aivaras",
    allowance: { weekly: gbp(30000), askAbove: gbp(5000), blockedCategories: ["gift_cards", "crypto"], allowedPayees: [], blockedPayees: [] },
  },
  {
    id: "leo",
    name: "Leo",
    kind: "kid",
    spotterName: "Aivaras",
    allowance: { weekly: gbp(1000), askAbove: gbp(500), blockedCategories: ["gambling", "crypto"], allowedPayees: [], blockedPayees: [] },
  },
];
