import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedWatchPanel, sharedSummary } from "./SharedWatch";
import type { SharedWatchView } from "@/core/shared-watch";

const v: SharedWatchView = {
  label: "Live: tracked by Channel3 for all demo families",
  productId: "nepgse3",
  item: "Sony WH-1000XM5 headphones",
  title: "Sony WH-1000XM5 Noise Cancelling Wireless Bluetooth Headphones",
  currency: "GBP",
  trackingSince: "2026-10-11T12:00:00.000Z",
  points: [
    { at: "2026-10-05T09:00:00.000Z", price: 22900 },
    { at: "2026-10-08T09:00:00.000Z", price: 19900 },
    { at: "2026-10-10T09:00:00.000Z", price: 21900 },
  ],
  status: "typical",
  lastCheckedAt: "2026-10-11T12:30:00.000Z",
  unreachableAt: null,
  shops: [
    { shop: "johnlewis.com", price: 19900 },
    { shop: "currys.co.uk", price: 22900 },
  ],
  shopsCheckedAt: "2026-10-09T12:30:00.000Z",
  problem: null,
  checked: "cached",
};
const html = (view: SharedWatchView | null, error?: string) => renderToStaticMarkup(createElement(SharedWatchPanel, { view, error: error ?? null }));

describe("the shared live watch panel", () => {
  it("says it is live, tracked by Channel3 for all demo families, with the product and when it was last checked", () => {
    const out = html(v);
    expect(out).toContain("Live: tracked by Channel3 for all demo families");
    expect(out).toContain("Sony WH-1000XM5 headphones");
    expect(out).toMatch(/Last checked/);
    expect(out).toContain("11 Oct");
    expect(out).toMatch(/Channel3 price tracking/);
  });

  it("is honest that it is shared and not something this family nearly paid for", () => {
    const out = html(v);
    expect(out).toMatch(/Shared by every demo family/);
    expect(out).toMatch(/nobody in your family nearly paid/i);
    expect(out).not.toMatch(/nearly paid £/);
    expect(out).not.toMatch(/Target/);
  });

  it("shows only the prices Channel3 returned: now, lowest and highest", () => {
    const out = html(v);
    expect(out).toContain("£219.00");
    expect(out).toContain("£199.00");
    expect(out).toContain("£229.00");
  });

  it("never calls an unchanged price a drop", () => {
    const flat = { ...v, points: [{ at: "2026-10-05T09:00:00.000Z", price: 19900 }, { at: "2026-10-10T09:00:00.000Z", price: 19900 }] };
    expect(sharedSummary(flat)).toMatch(/No change/);
    expect(html(flat)).not.toMatch(/dropped/i);
  });

  it("names a real fall and a real rise from Channel3's own points, and nothing more", () => {
    expect(sharedSummary({ ...v, points: [v.points[0]!, v.points[1]!] })).toMatch(/Down £30\.00 since 5 Oct/);
    expect(sharedSummary({ ...v, points: [v.points[1]!, v.points[2]!] })).toMatch(/Up £20\.00 since 8 Oct/);
  });

  it("lists today's prices at UK shops from the last check, even before Channel3 has recorded history", () => {
    const out = html({ ...v, points: [] });
    expect(out).toContain("johnlewis.com");
    expect(out).toContain("currys.co.uk");
    expect(out).toContain("£229.00");
    expect(out).toMatch(/UK shops at the last check/);
    // The date the shop prices were read, not the newer history check.
    expect(out).toContain("(9 Oct)");
  });

  it("names a product Channel3 can't track as that, not as an outage", () => {
    const out = html({ ...v, trackingSince: null, points: [], shops: [], problem: "not_found", unreachableAt: "2026-10-12T09:00:00.000Z" });
    expect(out).toMatch(/can.{1,6}t track this product/);
    expect(out).not.toMatch(/didn.{1,6}t answer/);
  });

  it("with one point or none, says the line is still filling in instead of drawing one", () => {
    expect(html({ ...v, points: [v.points[0]!] })).toMatch(/one price so far/);
    expect(html({ ...v, points: [] })).toMatch(/hasn.{1,6}t recorded a price/);
    expect(html({ ...v, points: [] })).not.toContain("pw-chart");
  });

  it("when Channel3 didn't answer, shows the stored history with the date it was last checked", () => {
    const out = html({ ...v, unreachableAt: "2026-10-12T09:00:00.000Z", problem: "unreachable" });
    expect(out).toMatch(/didn.{1,6}t answer/);
    expect(out).toContain("£219.00");
    expect(out).toMatch(/last checked on 11 Oct/);
  });

  it("before tracking has started, says so instead of claiming it is tracked", () => {
    const out = html({ ...v, trackingSince: null, points: [], lastCheckedAt: null, unreachableAt: "2026-10-12T09:00:00.000Z", problem: "unreachable" });
    expect(out).not.toContain("Live: tracked by Channel3");
    expect(out).toMatch(/hasn.{1,6}t started/);
  });

  it("shows a plain error and nothing invented when it couldn't load", () => {
    const out = html(null, "Couldn't load the shared price watch.");
    expect(out).toContain("Couldn&#x27;t load the shared price watch.");
    expect(out).not.toContain("£");
  });
});
