import { describe, expect, it } from "vitest";
import { namesOf, pageTabs, removePage, withNames } from "./pages";

const state = (pages: Array<{ id: string; name?: string }>, selectedPageId = pages[0]!.id) => ({ pages: pages.map((p) => ({ ...p, widgets: {} })), selectedPageId }) as never;

describe("page tabs", () => {
  it("lists pages with their names, falling back to the names we know, then to a number", () => {
    const names = { "incident-a": "Incident: Gran £400" };
    expect(pageTabs(state([{ id: "month", name: "This month" }, { id: "incident-a" }, { id: "p3" }], "incident-a"), names)).toEqual({
      tabs: [
        { id: "month", name: "This month", removable: false },
        { id: "incident-a", name: "Incident: Gran £400", removable: true },
        { id: "p3", name: "Page 3", removable: true },
      ],
      selected: "incident-a",
    });
  });

  it("remembers names and puts them back if Studio dropped them", () => {
    const names = namesOf(state([{ id: "month", name: "This month" }, { id: "x" }]));
    expect(names).toEqual({ month: "This month" });
    const back = withNames(state([{ id: "month" }, { id: "x" }]), names) as unknown as { pages: Array<{ name?: string }> };
    expect(back.pages.map((p) => p.name)).toEqual(["This month", undefined]);
  });

  it("removes a page and moves to the first page if it was open, but never removes the last one", () => {
    const s = removePage(state([{ id: "month" }, { id: "incident-a" }], "incident-a"), "incident-a") as unknown as { pages: Array<{ id: string }>; selectedPageId: string };
    expect(s.pages.map((p) => p.id)).toEqual(["month"]);
    expect(s.selectedPageId).toBe("month");
    const only = state([{ id: "month" }]);
    expect(removePage(only, "month")).toBe(only);
  });
});

describe("phone layout", () => {
  it("stacks every widget full width, one per row, in reading order, without touching the saved state", async () => {
    const { stackForPhone } = await import("./pages");
    const s = {
      pages: [
        {
          id: "p",
          widgets: {},
          widgetLayout: {
            right: { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 8 },
            left: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 6 },
            below: { xTrack: 0, yTrack: 8, xSpan: 24, ySpan: 10 },
          },
        },
      ],
      selectedPageId: "p",
    } as never;
    const before = JSON.stringify(s);
    const out = stackForPhone(s) as unknown as { pages: Array<{ widgetLayout: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> }> };
    expect(out.pages[0]!.widgetLayout).toEqual({
      left: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 6 },
      right: { xTrack: 0, yTrack: 6, xSpan: 24, ySpan: 8 },
      below: { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 10 },
    });
    expect(JSON.stringify(s)).toBe(before);
  });
});
