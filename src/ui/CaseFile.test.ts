import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseFile, CasePending } from "./CaseFile";
import type { Case } from "@/agents/case";

const base: Case = {
  status: "done",
  verdict: "likely_scam",
  headline: "A fake redelivery fee.",
  findings: [],
  ask: [],
  calls: [],
  dropped: 0,
  model: "test",
  ms: 1,
  page: { url: "https://parcels.example/t", finalUrl: "https://parcels.example/t", title: "Track", asks: { card: false, login: false, giftCard: false }, screenshot: "data:image/jpeg;base64,AAAA" },
};
const html = (c: Case, peekScrolls?: number | null) => renderToStaticMarkup(createElement(CaseFile, { c, currency: "GBP", peekScrolls }));

describe("the case file's proof card", () => {
  it("shows zero only for counts KERNEL recorded, and 'Not recorded' for the rest", () => {
    const out = html({ ...base, page: { ...base.page!, proof: { clicks: 0, keys: null, scrolls: 0, downloadsBlocked: null, apiCalls: 6, hashes: { screenshot: "f".repeat(64) }, deleted: true } } }, 3);
    expect(out).toContain("Proof Spotter never touched it");
    expect(out).toMatch(/<dt>Clicks<\/dt><dd>0<\/dd>/);
    expect(out).toMatch(/<dt>Keys typed<\/dt><dd>Not recorded<\/dd>/);
    expect(out).toMatch(/<dt>Downloads<\/dt><dd>Not recorded<\/dd>/);
    expect(out).toMatch(/<dt>Scrolls you asked for looking at it<\/dt><dd>3<\/dd>/);
    // Without the count (other callers) it says so, rather than "none".
    const noCount = html({ ...base, page: { ...base.page!, proof: { clicks: 0, keys: 0, scrolls: 0, downloadsBlocked: true, apiCalls: 1, hashes: {} } } });
    expect(noCount).toMatch(/<dt>Scrolls you asked for looking at it<\/dt><dd>Not recorded<\/dd>/);
    expect(out).toContain("f".repeat(64));
  });

  it("shows both faces with the verdict and the card form outlined only where it was found", () => {
    const out = html({
      ...base,
      page: {
        ...base.page!,
        phone: { finalUrl: "https://parcels.example/t", title: "Fee", asks: { card: true, login: false, giftCard: false }, network: "uk_mobile", screenshot: "data:image/jpeg;base64,BBBB", moneyBox: { x: 0.1, y: 0.4, w: 0.8, h: 0.3 } },
        faces: { compared: true, differs: true, verdict: "This page shows something different to phones in the UK than to security scanners: only the phone was asked for card details.", differences: [{ kind: "asks_money", desktop: "No card or bank form", phone: "Asks for card details", strong: true }], textOverlap: 0.1, lookSimilarity: 0.3 },
      },
    });
    expect(out).toContain("only the phone was asked for card details");
    expect(out).toContain("on a UK mobile network");
    expect(out.match(/class="faces-box"/g)).toHaveLength(1);
    expect(out).toContain('type="range"');
  });

  it("never shows a picture that isn't our own JPEG", () => {
    const out = html({ ...base, page: { ...base.page!, faces: { compared: true, differs: false, verdict: "Same.", differences: [], textOverlap: 1, lookSimilarity: 1 }, phone: { finalUrl: "x", title: "", asks: { card: false, login: false, giftCard: false }, network: "direct", screenshot: "https://evil.example/x.jpg" } } });
    expect(out).not.toContain("evil.example");
  });
});

// The server's clock is passed down (like the dashboard's serverNow), so the first client render matches the HTML
// even when the browser's clock is off. Nothing in these components reads Date.now() while rendering.
describe("the case file's clock", () => {
  const made = "2020-01-01T10:00:00Z";
  const at = (iso: string, ms: number) => Date.parse(iso) + ms;

  it("'looking into this' shows for two minutes after the payment by the clock it is given", () => {
    const pending = (now: number) => renderToStaticMarkup(createElement(CasePending, { createdAt: made, now }));
    expect(pending(at(made, 30_000))).toContain("Spotter is looking into this");
    expect(pending(at(made, 3 * 60_000))).toBe("");
  });

  it("offers the replay inside its window by the clock it is given, and never without one on the server", () => {
    const c: Case = { ...base, page: { ...base.page!, replay: { sealed: "s", at: made } } };
    const withNow = (now?: number) => renderToStaticMarkup(createElement(CaseFile, { c, currency: "GBP", paymentId: "pay_1", now }));
    expect(withNow(at(made, 60 * 60_000))).toContain("Watch Spotter open it");
    expect(withNow(at(made, 24 * 60 * 60_000))).not.toContain("Watch Spotter open it");
    expect(withNow()).not.toContain("Watch Spotter open it");
  });
});
