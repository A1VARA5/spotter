// The words in setup's live preview, built from what the person has typed or picked so far.
import type { HouseholdKind } from "@/core/households";
import { money } from "@/ui/format";
import { ON_HOLD } from "@/ui/labels";

/** The spotter's name as typed, or "you" until there is one ("You" is the placeholder a new household starts with). */
export const meName = (typed: string) => {
  const t = typed.trim();
  return t && t !== "You" ? t : "you";
};

/** A believable payment just over the limit: the next round £10 above it (or a plain £60 when nothing is set yet). */
export function exampleAmount(askAbovePence: number | undefined): number {
  if (askAbovePence === undefined || Number.isNaN(askAbovePence)) return 6000;
  if (askAbovePence <= 0) return 2000;
  const step = askAbovePence >= 20000 ? 5000 : 1000;
  return Math.floor(askAbovePence / step) * step + step;
}

/** The alert the spotter gets when this person goes over the limit that was just set. */
export function alertFor({ who, askAbove }: { who: string; askAbove: number | undefined }) {
  const amount = exampleAmount(askAbove);
  const pounds = (p: number) => money(p, "GBP").replace(/\.00$/, "");
  return {
    amount,
    title: `${who} wants to pay ${pounds(amount)}`,
    body:
      askAbove !== undefined && askAbove <= 0
        ? `You asked to see every payment. The money is ${ON_HOLD}.`
        : `Over the ${pounds(askAbove ?? 5000)} you set for one payment. The money is ${ON_HOLD}.`,
  };
}

/** Who the preview shows paying: the person being added, else the first person (not agent) already added, else a stand in. */
export function payerFor({ draftName, people, kind, avoid }: { draftName: string; people: Array<{ name: string; kind: string }>; kind: HouseholdKind; avoid?: string }) {
  const typed = draftName.trim();
  if (typed) return typed;
  const added = people.find((p) => p.kind !== "agent")?.name ?? people[0]?.name;
  if (added) return added;
  const [first, second] = kind === "business" ? ["Tom", "Ana"] : ["Gran", "Nan"];
  return avoid && avoid.trim().toLowerCase() === first.toLowerCase() ? second : first;
}
