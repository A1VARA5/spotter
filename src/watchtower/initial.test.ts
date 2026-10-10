import { describe, expect, it } from "vitest";
import { INITIAL, promptStarters, startingBoard } from "./initial";
import type { PersonRow } from "./data";

type W = { type: string; dataMapping: Record<string, Array<{ id: string }>>; format?: { title: { text: string } } };
const widgets = (s: unknown) => (s as { pages: Array<{ widgets: Record<string, W> }> }).pages[0]!.widgets;
const titles = (s: unknown) => Object.values(widgets(s)).flatMap((w) => (w.format ? [w.format.title.text] : []));

const family: PersonRow[] = [
  { name: "Shopping agent", kind: "AI agent", weeklyAllowance: 400, spentThisWeek: 0 },
  { name: "Gran", kind: "Person", weeklyAllowance: 300, spentThisWeek: 0 },
  { name: "Leo", kind: "Kid", weeklyAllowance: 10, spentThisWeek: 0 },
];
const business: PersonRow[] = [
  { name: "Tom", kind: "Person", weeklyAllowance: 3000, spentThisWeek: 0 },
  { name: "Buying agent", kind: "AI agent", weeklyAllowance: 2000, spentThisWeek: 0 },
];

describe("starting board", () => {
  it("families keep exactly the board they had", () => {
    expect(startingBoard("family")).toBe(INITIAL);
  });

  it("a business gets the same widgets with business titles, and suppliers by payee", () => {
    const b = startingBoard("business");
    expect(Object.keys(widgets(b))).toEqual(Object.keys(widgets(INITIAL)));
    expect(Object.values(widgets(b)).map((w) => w.type)).toEqual(Object.values(widgets(INITIAL)).map((w) => w.type));
    expect(titles(b)).toEqual(expect.arrayContaining(["Spend by person", "Suppliers", "Invoices caught"]));
    expect(widgets(b).categories!.dataMapping.cols![0]!.id).toBe("payments.payee");
    // The family board isn't touched by building the business one.
    expect(titles(INITIAL)).toContain("Who asked to pay, and what happened");
  });
});

describe("prompt starters", () => {
  it("families start with the fair price check (Spotter's agent and Channel3) and the weekly brief", () => {
    const starters = promptStarters(family, "family");
    expect(starters.map((s) => s.label)).toEqual(["Did we pay fair prices this month?", "Write this week's brief", "Why was Gran stopped?", "What did Leo spend on games?", "Build a scam report"]);
    expect(starters[0]!.prompt).toMatch(/real shops/);
    expect(starters[1]!.prompt).toMatch(/weekly brief/);
  });

  it("a business gets starters in business terms", () => {
    const labels = promptStarters(business, "business").map((s) => s.label);
    expect(labels).toEqual(["Did we pay fair prices this month?", "Write this week's brief", "Which invoices were caught?", "Who spent the most?", "Build a supplier report"]);
    expect(labels.join(" ")).not.toMatch(/games|scam report/);
  });
});

describe("fair price on the starting board", () => {
  it("sits on both boards beside the watch alerts, without overlapping anything", () => {
    for (const kind of ["family", "business"] as const) {
      const page = (startingBoard(kind) as unknown as { pages: Array<{ widgets: Record<string, W>; widgetLayout: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> }> }).pages[0]!;
      expect(page.widgets.fair).toEqual({ type: "fair-price", dataMapping: {} });
      const boxes = Object.values(page.widgetLayout);
      for (const [i, a] of boxes.entries())
        for (const b of boxes.slice(i + 1)) {
          const apart = a.xTrack + a.xSpan <= b.xTrack || b.xTrack + b.xSpan <= a.xTrack || a.yTrack + a.ySpan <= b.yTrack || b.yTrack + b.ySpan <= a.yTrack;
          expect(apart).toBe(true);
        }
      expect(page.widgetLayout.fair!.yTrack).toBe(page.widgetLayout.alerts!.yTrack);
    }
  });
});
