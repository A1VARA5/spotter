import type { PaymentStatus } from "@/db/schema";

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

export const STATE_LABEL: Record<TrackState, string> = {
  checking: "Checking",
  moving: "Paying",
  held: "Waiting for you",
  paid: "Paid",
  blocked: "Stopped",
  protected: "Not sent, pay with protection instead",
  returned: "Denied, money released",
  failed: "PayPal said no",
};

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
