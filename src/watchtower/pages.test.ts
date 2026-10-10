import { describe, expect, it } from "vitest";
import { addPage, namesOf, pageTabs, removePage, withNames } from "./pages";

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

describe("addPage (the agents' add_page tool)", () => {
  type P = { pages: Array<{ id: string; name?: string; widgets: object }>; selectedPageId: string };
  it("adds an empty named page, selects it and returns its id", () => {
    const { state, pageId } = addPage(state0(), "Week of 5 Oct 2026");
    const s = state as unknown as P;
    expect(pageId).toBe("page-week-of-5-oct-2026");
    expect(s.pages.at(-1)).toEqual({ id: pageId, name: "Week of 5 Oct 2026", widgets: {}, widgetLayout: {} });
    expect(s.selectedPageId).toBe(pageId);
  });

  it("reuses a page with the same name instead of making a second one", () => {
    const once = addPage(state0(), "Week of 5 Oct 2026").state;
    const again = addPage(once, " week of 5 oct 2026 ");
    expect(again.pageId).toBe("page-week-of-5-oct-2026");
    expect((again.state as unknown as P).pages).toHaveLength(2);
  });

  it("keeps names short and plain, and refuses an empty one", () => {
    expect((addPage(state0(), "<img src=x> Report!!​" + "x".repeat(80)).state as unknown as P).pages.at(-1)!.name).toBe("img src x Report!!" + "x".repeat(22));
    expect(() => addPage(state0(), "  <>  ")).toThrow(/name/);
  });

  it("gives different names different ids even when they slug the same", () => {
    const a = addPage(state0(), "Fair price").state;
    expect(addPage(a, "Fair price?").pageId).toBe("page-fair-price-2");
  });
});

const state0 = () => state([{ id: "month", name: "This month" }]);
