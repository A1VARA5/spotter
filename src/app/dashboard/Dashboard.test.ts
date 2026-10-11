import { describe, expect, it } from "vitest";
import type { Payment } from "@/core/lifecycle";
import { feedEmpty, firstToOpen, withoutHoldFinding } from "./Dashboard";
import type { Case } from "@/agents/case";

describe("withoutHoldFinding (one expiry date per held card)", () => {
  it("drops the PayPal hold finding, which repeats the hold clock's date, and keeps the rest", () => {
    const c = { findings: [{ tool: "paypal_hold", text: "ends 9 Nov" }, { tool: "payee_history", text: "never paid" }] } as unknown as Case;
    expect(withoutHoldFinding(c).findings.map((f) => f.tool)).toEqual(["payee_history"]);
    expect(c.findings).toHaveLength(2);
  });

  it("returns the same case when there is nothing to drop", () => {
    const c = { findings: [{ tool: "open_link", text: "x" }] } as unknown as Case;
    expect(withoutHoldFinding(c)).toBe(c);
  });
});
import { timeAgo } from "@/ui/format";

const pay = (id: string, extra: Partial<Payment> = {}) => ({ id, case_file: null, ai: null, ...extra }) as unknown as Payment;

describe("firstToOpen (which held card opens on its own)", () => {
  it("opens nothing when nothing waits", () => {
    expect(firstToOpen([])).toBeNull();
  });

  it("opens the oldest hold when none looks like a scam (the list is newest first)", () => {
    expect(firstToOpen([pay("new"), pay("old")])).toBe("old");
  });

  it("opens a likely scam before an older ordinary hold", () => {
    const scam = pay("scam", { case_file: { verdict: "likely_scam" } as Payment["case_file"] });
    expect(firstToOpen([pay("new"), scam, pay("old")])).toBe("scam");
  });

  it("treats a high severity flag from the message check as risky too", () => {
    const flagged = pay("flagged", { ai: { flags: [{ severity: "high" }] } as unknown as Payment["ai"] });
    expect(firstToOpen([flagged, pay("old")])).toBe("flagged");
  });
});

describe("feedEmpty (Everything today with nothing else in it)", () => {
  it("says no payments only when there really are none", () => {
    expect(feedEmpty(0)).toBe("No payments yet.");
  });

  it("counts the held ones instead of saying no payments while a hold waits", () => {
    expect(feedEmpty(1)).toBe("Nothing else yet. The one payment so far is waiting for you.");
    expect(feedEmpty(3)).toBe("Nothing else yet. All 3 payments so far are waiting for you.");
    expect(feedEmpty(1)).not.toMatch(/No payments/);
  });
});

describe("relative times use one clock (hydration error 418)", () => {
  it("gives the same text for the same now, whatever the real clock says", () => {
    const created = new Date(Date.UTC(2026, 9, 11, 12, 0, 0)).toISOString();
    const serverNow = Date.UTC(2026, 9, 11, 12, 5, 10);
    expect(timeAgo(created, serverNow)).toBe("5 min ago");
    // A browser clock 150 seconds ahead used to render "8 min ago" on the first client render.
    expect(timeAgo(created, serverNow + 150_000)).not.toBe(timeAgo(created, serverNow));
  });
});
