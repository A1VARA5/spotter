import { describe, expect, it } from "vitest";
import type { Payment } from "@/core/lifecycle";
import { aiFailedLine, checkComplete, decidedResult, denyLeads, feedEmpty, firstToOpen, orientLine, shortPayPalId, waitingChanged, withoutHoldFinding } from "./Dashboard";
import type { Case } from "@/agents/case";

// Round 8 m5: the "Worth a closer look" earbuds card showed Approve before Deny. Deny leads on every card that isn't clean.
describe("denyLeads (Deny first unless the check came back clean)", () => {
  const ok = { ok: true, flags: [] } as unknown as Payment["ai"];
  const verdict = (v: Case["verdict"]) => ({ status: "done", verdict: v }) as Case;
  it("Deny leads on a likely scam, a closer look, an unfinished check, or any warning sign", () => {
    expect(denyLeads({ ai: ok, case_file: verdict("likely_scam") })).toBe(true);
    expect(denyLeads({ ai: ok, case_file: verdict("unclear") })).toBe(true);
    expect(denyLeads({ ai: ok, case_file: null })).toBe(true);
    const medium = { ok: true, flags: [{ kind: "pressure", severity: "medium", quote: "today", why: "" }] } as unknown as Payment["ai"];
    expect(denyLeads({ ai: medium, case_file: verdict("looks_fine") })).toBe(true);
  });
  it("Approve leads only when the finished check says it looks genuine and found nothing", () => {
    expect(denyLeads({ ai: ok, case_file: verdict("looks_fine") })).toBe(false);
    const low = { ok: true, flags: [{ kind: "other", severity: "low", quote: "x", why: "" }] } as unknown as Payment["ai"];
    expect(denyLeads({ ai: low, case_file: verdict("looks_fine") })).toBe(false);
  });
});

describe("checkComplete (Deny leads until the AI has looked)", () => {
  const ok = { ok: true } as Payment["ai"];
  const failed = { ok: false, error: "no Anthropic key could be used" } as Payment["ai"];
  const done = { status: "done" } as Case;
  it("is complete only when the message check ran and the case file was written with the model", () => {
    expect(checkComplete({ ai: ok, case_file: done })).toBe(true);
    expect(checkComplete({ ai: ok, case_file: { status: "partial" } as Case })).toBe(true);
  });
  it("is not complete while the case is still being built, when the case failed, or when no AI could answer", () => {
    expect(checkComplete({ ai: ok, case_file: null })).toBe(false);
    expect(checkComplete({ ai: ok, case_file: { status: "failed" } as Case })).toBe(false);
    expect(checkComplete({ ai: ok, case_file: { status: "partial", aiDown: true } as Case })).toBe(false);
    expect(checkComplete({ ai: failed, case_file: done })).toBe(false);
    expect(checkComplete({ ai: null, case_file: done })).toBe(false);
  });
  it("says the AI check is down only for an outage, and 'couldn't finish' for any other failure", () => {
    expect(aiFailedLine({ ai: { ...failed!, aiDown: true } })).toBe("The AI check is down right now, so Spotter held this for you. Nothing is paid.");
    expect(aiFailedLine({ ai: failed })).toBe("The AI check couldn't finish on this one, so Spotter held it for you. Nothing is paid.");
    expect(aiFailedLine({ ai: ok })).toBeNull();
    expect(aiFailedLine({ ai: null })).toBeNull();
  });
});

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

describe("waitingChanged (the sidebar's Waiting for you count follows the queue)", () => {
  const at = (...statuses: string[]) => statuses.map((status) => ({ status }) as Pick<Payment, "status">);
  it("gives the new count when a payment left needs_approval (a Deny), so the shell is refreshed", () => {
    expect(waitingChanged(1, at("voided", "captured"))).toBe(0);
    expect(waitingChanged(1, at("voiding"))).toBe(0);
  });
  it("gives the new count when a new hold arrives", () => {
    expect(waitingChanged(1, at("needs_approval", "needs_approval"))).toBe(2);
  });
  it("is null when the count didn't change, so the shell isn't refreshed every poll", () => {
    expect(waitingChanged(1, at("needs_approval", "voided"))).toBeNull();
  });
});

// UX audit 12 Oct #9 and #16: a decision ends on a clear result where the card was, never a vanished card.
describe("decidedResult (what the card turns into after Approve or Deny)", () => {
  const held = (extra: Partial<Payment> = {}) =>
    ({ id: "pay_1", status: "needs_approval", amount: "25000", currency: "GBP", request: { payee: { name: "jamie.k1994@mail.example" } }, paypal_authorization_id: "4DX12345AB6789012", paypal_capture_id: null, error: null, ...extra }) as unknown as Payment;

  it("Deny: PayPal cancelled the hold, nothing was paid, with the authorisation's id and its Activity row", () => {
    const r = decidedResult(held({ status: "voided" }));
    expect(r).toMatchObject({ state: "returned", title: "Denied", line: "PayPal cancelled the hold. Nothing was paid.", paypalId: "4DX12345AB6789012", href: "/ledger#pay-pay_1" });
  });

  it("Approve: PayPal took the money, said as the sandbox, with the capture's id", () => {
    const r = decidedResult(held({ status: "captured", paypal_capture_id: "9CAP0000000001234" }));
    expect(r).toMatchObject({ state: "paid", title: "Approved", line: "PayPal took the £250.00 (sandbox).", paypalId: "9CAP0000000001234" });
  });

  it("says a capture still under way as under way, never as taken", () => {
    expect(decidedResult(held({ status: "capturing" })).line).toBe("PayPal is taking the £250.00 (sandbox).");
  });

  it("never says cancelled before PayPal confirmed the void", () => {
    const r = decidedResult(held({ status: "voiding", error: "timeout" }));
    expect(r.title).toBe("Denied");
    expect(r.line).not.toMatch(/cancelled the hold/);
    expect(r.line).toMatch(/won't pay/);
  });

  it("a declined capture says nothing was paid", () => {
    expect(decidedResult(held({ status: "failed" })).line).toMatch(/Nothing was paid/);
  });

  it("short PayPal ids keep the last 6 characters", () => {
    expect(shortPayPalId("4DX12345AB6789012")).toBe("789012");
    expect(shortPayPalId(null)).toBeNull();
  });
});

// UX audit 12 Oct #18: a judge lands on the demo dashboard and needs to know who they are.
describe("orientLine (one line for demo families)", () => {
  it("names the spotter, the relative and the demo PIN while something waits", () => {
    expect(orientLine({ demo: true, business: false, spotter: "Sam", who: "Gran" })).toBe("You're Sam, Gran's spotter. Deny it, or approve with the demo PIN 2468.");
  });
  it("is null for real families, business demos and when nothing waits", () => {
    expect(orientLine({ demo: false, business: false, spotter: "Sam", who: "Gran" })).toBeNull();
    expect(orientLine({ demo: true, business: true, spotter: "Sam", who: "Gran" })).toBeNull();
    expect(orientLine({ demo: true, business: false, spotter: "Sam", who: null })).toBeNull();
  });
});
