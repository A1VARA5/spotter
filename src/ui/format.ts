import type { PaymentStatus } from "@/db/schema";
import type { Payment } from "@/core/lifecycle";
import { OUTCOME_WORDS } from "./labels";

export function money(minor: number | string, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(minor) / 100);
}

export type TrackState = "checking" | "moving" | "held" | "paid" | "blocked" | "protected" | "returned" | "failed";

export function trackState(status: PaymentStatus): TrackState {
  switch (status) {
    case "checking":
      return "checking";
    case "needs_approval":
      return "held";
    case "authorised":
    case "capturing":
      return "moving";
    case "captured":
      return "paid";
    case "blocked":
      return "blocked";
    case "protected":
      return "protected";
    case "voiding":
    case "voided":
      return "returned";
    case "failed":
      return "failed";
  }
}

/**
 * A capture or void PayPal didn't confirm (core/lifecycle.ts leaves it capturing or voiding with the reason, and the
 * reconcile job finishes it). Not a dead end: the line says Spotter is retrying. Null for everything else.
 */
export function paypalPending(p: { status: string; error: string | null }): { kind: "void" | "capture"; text: string } | null {
  if (!p.error) return null;
  if (p.status === "voiding") return { kind: "void", text: "PayPal didn't confirm yet, retrying. Spotter won't pay it, and asks PayPal again to let the hold go within a day. Try PayPal again does it now." };
  if (p.status === "capturing") return { kind: "capture", text: "PayPal didn't confirm yet, retrying. Spotter asks PayPal again within a day with the same request, so it can't be paid twice. Try PayPal again does it now." };
  return null;
}

/** The status pill words, from the one vocabulary in labels.ts. */
export const STATE_LABEL = Object.fromEntries(Object.entries(OUTCOME_WORDS).map(([k, v]) => [k, v.long])) as Record<TrackState, string>;

type Linked = Pick<Payment, "id" | "status" | "amount" | "currency" | "request">;

/**
 * One line tying a replaced payment to its replacement, both ways. On the replacement it tells the whole story
 * ("Shopping agent tried GadgetBarn (stopped: hidden instructions), then bought from ... instead."); on the stopped
 * payment it says what replaced it. id is the other payment. Null when there is no link.
 */
export function replacementLink(p: Linked, all: Linked[], who: string): { id: string; text: string } | null {
  const from = p.request.swappedFrom;
  if (from) {
    const first = all.find((x) => x.id === from);
    const safer = p.request.saferOption;
    if (!safer) return { id: from, text: `Bought instead of the held payment to ${first?.request.payee.name ?? "another shop"}.` };
    const was = first && first.status !== "blocked" ? "held" : "stopped";
    const s = trackState(p.status);
    const did = s === "paid" ? "bought from" : s === "held" ? "asked to buy from" : "tried";
    return {
      id: from,
      text: `${who} tried ${safer.from_payee} (${was}: ${safer.reason}), then ${did} ${p.request.payee.name} for ${money(p.amount, p.currency)} instead.`,
    };
  }
  const next = all.find((x) => x.request.swappedFrom === p.id);
  if (!next) return null;
  return { id: next.id, text: `Replaced by ${next.request.payee.name}, ${money(next.amount, next.currency)} (${STATE_LABEL[trackState(next.status)]}).` };
}

/** Find each quote inside the original text, tolerant of whitespace and case. Returns non overlapping ranges. */
export function findQuotes(text: string, quotes: string[]): Array<{ start: number; end: number; i: number }> {
  const ranges: Array<{ start: number; end: number; i: number }> = [];
  quotes.forEach((q, i) => {
    const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return;
    const m = new RegExp(words.join("\\s+"), "i").exec(text);
    if (m && !ranges.some((r) => m.index < r.end && m.index + m[0].length > r.start)) {
      ranges.push({ start: m.index, end: m.index + m[0].length, i });
    }
  });
  return ranges.sort((a, b) => a.start - b.start);
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
