// Grounding: code, not the model, decides which flags are real. A flag survives only if its
// quote is literally in the context the model read. spec.md > The core loop, step 3.

export type FlagKind =
  | "pressure"
  | "impersonation"
  | "friends_and_family"
  | "gift_card_or_crypto"
  | "prompt_injection"
  | "price"
  | "new_shop"
  | "other";

export type Severity = "low" | "medium" | "high";
export type Flag = { kind: FlagKind; severity: Severity; quote: string; why: string };

export const MAX_FLAGS = 6;
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export function groundFlags(flags: Flag[], context: string): { kept: Flag[]; dropped: number } {
  const haystack = normalise(context);
  const real = flags.filter((f) => {
    const q = normalise(f.quote ?? "");
    return q.length > 0 && haystack.includes(q);
  });
  const sorted = [...real].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const kept = sorted.slice(0, MAX_FLAGS);
  return { kept, dropped: flags.length - kept.length };
}
