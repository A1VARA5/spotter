import { describe, expect, it } from "vitest";
import { ANSWER_SPAN, addPage, newestAnswer, fitWide, namesOf, pageTabs, placeAnswer, removePage, unfitWide, withNames } from "./pages";
import { INITIAL } from "./initial";

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

describe("wide screens: text tiles get shorter so they aren't half empty", () => {
  type L = Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }>;
  const layoutOf = (s: unknown, id = "month") => (s as { pages: Array<{ id: string; widgetLayout: L }> }).pages.find((p) => p.id === id)!.widgetLayout;

  it("leaves laptops alone", () => {
    expect(fitWide(INITIAL, 1440).state).toBe(INITIAL);
  });

  it("shortens the text tile rows at 1920 and more at 2560, keeps charts the same height, and repacks with no gaps or overlaps", () => {
    const before = layoutOf(INITIAL);
    for (const w of [1920, 2560]) {
      const l = layoutOf(fitWide(INITIAL, w).state);
      expect(l.alerts!.ySpan).toBeLessThan(before.alerts!.ySpan);
      expect(l.fair!.ySpan).toBe(l.alerts!.ySpan);
      expect(l.kept).toEqual(before.kept);
      expect(l.outcomes!.ySpan).toBe(before.outcomes!.ySpan);
      // the row under the text tiles starts right where they end
      expect(l.watches!.yTrack).toBe(l.alerts!.yTrack + l.alerts!.ySpan);
      const boxes = Object.values(l);
      for (const [i, a] of boxes.entries())
        for (const b of boxes.slice(i + 1)) expect(a.xTrack + a.xSpan <= b.xTrack || b.xTrack + b.xSpan <= a.xTrack || a.yTrack + a.ySpan <= b.yTrack || b.yTrack + b.ySpan <= a.yTrack).toBe(true);
    }
    expect(layoutOf(fitWide(INITIAL, 2560).state).alerts!.ySpan).toBeLessThan(layoutOf(fitWide(INITIAL, 1920).state).alerts!.ySpan);
  });

  it("never saves the shortened layout: unfitWide puts the original back", () => {
    const { state, fitted } = fitWide(INITIAL, 2560);
    expect(layoutOf(unfitWide(state, fitted))).toEqual(layoutOf(INITIAL));
  });

  it("still puts the untouched tiles back when someone moved one tile or added one, and maps those onto the original rows", () => {
    const { state, fitted } = fitWide(INITIAL, 2560);
    const before = layoutOf(INITIAL);
    const moved = structuredClone(state) as unknown as { pages: Array<{ widgetLayout: L }> };
    const l = moved.pages[0]!.widgetLayout;
    l.kept!.xSpan = 5;
    l.extra = { xTrack: 0, yTrack: l.ledger!.yTrack, xSpan: 6, ySpan: 6 };
    const out = layoutOf(unfitWide(moved as never, fitted));
    expect(out.alerts).toEqual(before.alerts);
    expect(out.ledger).toEqual(before.ledger);
    expect(out.kept).toEqual({ ...before.kept, xSpan: 5 });
    expect(out.extra!.yTrack).toBe(before.ledger!.yTrack);
    // saving then loading again doesn't shrink twice
    expect(layoutOf(fitWide(unfitWide(state, fitted), 2560).state)).toEqual(layoutOf(state));
  });

  it("leaves a page alone when its rows aren't clean bands (someone arranged it by hand)", () => {
    const odd = { pages: [{ id: "p", widgets: { a: { type: "watch-alerts" }, b: { type: "grid" } }, widgetLayout: { a: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 28 }, b: { xTrack: 12, yTrack: 5, xSpan: 12, ySpan: 10 } } }], selectedPageId: "p" } as never;
    expect(layoutOf(fitWide(odd, 2560).state, "p")).toEqual(layoutOf(odd, "p"));
  });
});

describe("a tile for a typed question (place_widget)", () => {
  type Pg = { id: string; name: string; widgets: Record<string, { type: string }>; widgetLayout: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> };
  const allowed = new Set(["bar-chart-grouped", "donut-chart", "grid"]);
  const board = () =>
    ({
      pages: [{ id: "month", name: "This month", widgets: { kept: { type: "money-kept" } }, widgetLayout: { kept: { xTrack: 0, yTrack: 0, xSpan: 7, ySpan: 11 } } }],
      selectedPageId: "month",
    }) as never;
  const pageOf = (s: unknown, id: string) => (s as { pages: Pg[] }).pages.find((p) => p.id === id)!;

  it("puts an empty tile of the asked type at the top of an Answers page, full width, and shows that page", () => {
    const r = placeAnswer(board(), {}, "bar-chart-grouped", allowed);
    const page = pageOf(r.state, r.pageId);
    expect(page.name).toBe("Answers");
    expect((r.state as unknown as { selectedPageId: string }).selectedPageId).toBe(r.pageId);
    expect(page.widgets[r.widgetId]).toEqual({ type: "bar-chart-grouped" });
    expect(page.widgetLayout[r.widgetId]).toEqual({ xTrack: 0, yTrack: 0, xSpan: 24, ySpan: ANSWER_SPAN });
    // the board's own page is untouched
    expect(pageOf(r.state, "month").widgets).toEqual({ kept: { type: "money-kept" } });
  });

  it("puts the newest answer on top and moves older ones down, never reusing an id", () => {
    const one = placeAnswer(board(), {}, "bar-chart-grouped", allowed);
    const two = placeAnswer(one.state, {}, "donut-chart", allowed);
    expect(two.pageId).toBe(one.pageId);
    expect(two.widgetId).not.toBe(one.widgetId);
    const page = pageOf(two.state, two.pageId);
    expect(page.widgetLayout[two.widgetId]!.yTrack).toBe(0);
    expect(page.widgetLayout[one.widgetId]!.yTrack).toBe(ANSWER_SPAN);
  });

  it("titles the new tile with the question's title", () => {
    const r = placeAnswer(board(), {}, "bar-chart-grouped", allowed, "What Leo spent on games");
    expect(pageOf(r.state, r.pageId).widgets[r.widgetId]).toEqual({ type: "bar-chart-grouped", format: { title: { enabled: true, text: "What Leo spent on games" } } });
    expect(r.reused).toBe(false);
  });

  it("reuses the tile for the same question instead of adding a second, and moves it to the top", () => {
    const one = placeAnswer(board(), {}, "bar-chart-grouped", allowed, "What Leo spent on games");
    // the widget agent set it up
    (pageOf(one.state, one.pageId).widgets[one.widgetId] as unknown as { dataMapping: unknown }).dataMapping = { valueKey: [{ id: "payments.amount" }] };
    const other = placeAnswer(one.state, {}, "donut-chart", allowed, "Where the money went");
    const again = placeAnswer(other.state, {}, "bar-chart-grouped", allowed, "  what leo spent on GAMES ");
    expect(again.widgetId).toBe(one.widgetId);
    expect(again.reused).toBe(true);
    const page = pageOf(again.state, again.pageId);
    expect(Object.keys(page.widgets)).toHaveLength(2);
    expect(page.widgetLayout[one.widgetId]!.yTrack).toBe(0);
    expect(page.widgetLayout[other.widgetId]!.yTrack).toBe(ANSWER_SPAN);
  });

  it("never calls a tile reused while it is still empty (so the widget agent still sets it up)", () => {
    const one = placeAnswer(board(), {}, "bar-chart-grouped", allowed, "Leo on games");
    const again = placeAnswer(one.state, {}, "bar-chart-grouped", allowed, "Leo on games");
    expect(again.widgetId).toBe(one.widgetId);
    expect(again.reused).toBe(false);
  });

  it("says plainly when the catalogue couldn't be read, rather than blaming the type", () => {
    expect(() => placeAnswer(board(), {}, "bar-chart-grouped", new Set())).toThrow(/catalogue isn't available/i);
  });

  it("replaces the tile in place when the same question now wants a different chart", () => {
    const one = placeAnswer(board(), {}, "bar-chart-grouped", allowed, "Leo on games");
    const again = placeAnswer(one.state, {}, "donut-chart", allowed, "Leo on games");
    expect(again.widgetId).toBe(one.widgetId);
    expect(again.reused).toBe(false);
    expect(pageOf(again.state, again.pageId).widgets[one.widgetId]).toEqual({ type: "donut-chart", format: { title: { enabled: true, text: "Leo on games" } } });
  });

  it("finds the same question by the title the widget agent set, too", () => {
    const one = placeAnswer(board(), {}, "bar-chart-grouped", allowed);
    const page = pageOf(one.state, one.pageId);
    (page.widgets[one.widgetId] as unknown as { format: unknown }).format = { title: { enabled: true, text: "Leo on games" } };
    expect(placeAnswer(one.state, {}, "bar-chart-grouped", allowed, "Leo on games").widgetId).toBe(one.widgetId);
  });

  it("keeps one tile per kind for Spotter's own tiles (like fair price), whatever the title", () => {
    const fair = new Set([...allowed, "fair-price"]);
    const one = placeAnswer(board(), {}, "fair-price", fair, "Fair prices");
    const again = placeAnswer(one.state, {}, "fair-price", fair, "Did we pay fair prices?");
    expect(again.widgetId).toBe(one.widgetId);
    expect(again.reused).toBe(true);
  });

  it("knows the newest answer: the tile at the top of the Answers page, its title and whether it's still empty", () => {
    expect(newestAnswer(board())).toBeNull();
    const one = placeAnswer(board(), {}, "bar-chart-grouped", allowed, "Leo on games");
    expect(newestAnswer(one.state)).toEqual({ pageId: one.pageId, widgetId: one.widgetId, title: "Leo on games", empty: true });
    (pageOf(one.state, one.pageId).widgets[one.widgetId] as unknown as { dataMapping: unknown }).dataMapping = { valueKey: [{ id: "payments.amount" }] };
    expect(newestAnswer(one.state)?.empty).toBe(false);
  });

  it("refuses a widget type that isn't in the allowed catalogue (no image or free text tiles)", () => {
    expect(() => placeAnswer(board(), {}, "image", allowed)).toThrow(/can't place/i);
  });
});
