import { describe, expect, it } from "vitest";
import type { Payment } from "@/core/lifecycle";
import { firstToOpen } from "./Dashboard";
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

describe("relative times use one clock (hydration error 418)", () => {
  it("gives the same text for the same now, whatever the real clock says", () => {
    const created = new Date(Date.UTC(2026, 9, 11, 12, 0, 0)).toISOString();
    const serverNow = Date.UTC(2026, 9, 11, 12, 5, 10);
    expect(timeAgo(created, serverNow)).toBe("5 min ago");
    // A browser clock 150 seconds ahead used to render "8 min ago" on the first client render.
    expect(timeAgo(created, serverNow + 150_000)).not.toBe(timeAgo(created, serverNow));
  });
});
