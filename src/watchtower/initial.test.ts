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
  it("families get the same starters as before", () => {
    expect(promptStarters(family, "family").map((s) => s.label)).toEqual([
      "What did Leo spend on games?",
      "Why was Gran stopped?",
      "Build a scam report",
      "Is the shopping agent behaving?",
    ]);
  });

  it("a business gets starters in business terms", () => {
    const labels = promptStarters(business, "business").map((s) => s.label);
    expect(labels).toEqual(["Who spent the most?", "Which invoices were caught?", "Build a supplier report", "Is the buying agent behaving?"]);
    expect(labels.join(" ")).not.toMatch(/games|scam report/);
  });
});
