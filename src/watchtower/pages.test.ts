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
