import { describe, expect, it } from "vitest";
import type { AgReportState } from "ag-studio";
import { captureEnd, captureStart, durable, redoRun, undoRun, type BoardApi } from "./runUndo";

const board = (pages: string[], selected = pages[0]!) => ({ pages: pages.map((id) => ({ id, name: id, widgets: {} })), selectedPageId: selected }) as unknown as AgReportState;

/** A fake Studio with AG's history rules: each setState is an entry, undo(id) goes back through it, redo(id) forward. */
function fakeStudio(start: AgReportState): BoardApi & { change(s: AgReportState): void } {
  let n = 0;
  let current = start;
  const undo: Array<{ id: string; state: AgReportState; label: string; at: number }> = []; // state = what restoring gives
  let redo: typeof undo = [];
  const api = {
    getState: () => current,
    setState(s: AgReportState) {
      undo.push({ id: `entry:${++n}`, state: current, label: "Edit", at: n });
      redo = [];
      current = s;
    },
    getHistory: () => ({ undo: [...undo], redo: [...redo] }),
    undo(id?: string) {
      const i = id ? undo.findIndex((e) => e.id === id) : undo.length - 1;
      if (i < 0) return;
      while (undo.length > i) {
        const e = undo.pop()!;
        redo.push({ ...e, state: current });
        current = e.state;
      }
    },
    redo(id?: string) {
      const i = id ? redo.findIndex((e) => e.id === id) : redo.length - 1;
      if (i < 0) return;
      while (redo.length > i) {
        const e = redo.pop()!;
        undo.push({ ...e, state: current });
        current = e.state;
      }
    },
    change(s: AgReportState) {
      api.setState(s);
    },
  };
  return api;
}

describe("undo what Spotter changed", () => {
  it("undoes exactly the run's changes and redoes them, through Studio's history", () => {
    const api = fakeStudio(board(["month"]));
    api.change(board(["month", "mine"])); // the family's own change before asking
    const start = captureStart(api);
    api.change(board(["month", "mine", "spotter"])); // add_page
    api.change(board(["month", "mine", "spotter2"])); // configure_widget
    const rc = captureEnd(api, start);
    expect(rc.count).toBe(2);
    const u = undoRun(api, rc);
    expect(u.ok).toBe(true);
    expect(u.message).toBe("Undone: 2 changes Spotter made. The board is back as it was before you asked.");
    expect(durable(api.getState())).toBe(durable(board(["month", "mine"])));
    expect(undoRun(api, rc).ok).toBe(false);
    const r = redoRun(api, rc);
    expect(r).toEqual({ ok: true, message: "Redone: Spotter's 2 changes are back." });
    expect(durable(api.getState())).toBe(durable(board(["month", "mine", "spotter2"])));
  });

  it("says so when the run changed nothing", () => {
    const api = fakeStudio(board(["month"]));
    const rc = captureEnd(api, captureStart(api));
    expect(rc.count).toBe(0);
    expect(undoRun(api, rc)).toEqual({ ok: false, message: "Spotter didn't change the board in that run." });
  });

  it("won't undo over a change the family made after the run", () => {
    const api = fakeStudio(board(["month"]));
    const start = captureStart(api);
    api.change(board(["month", "spotter"]));
    const rc = captureEnd(api, start);
    api.change(board(["month", "spotter", "mine"]));
    const u = undoRun(api, rc);
    expect(u.ok).toBe(false);
    expect(u.message).toMatch(/changed since/);
    expect(durable(api.getState())).toBe(durable(board(["month", "spotter", "mine"])));
  });

  it("after a live remount (new Studio, new history) falls back to the board saved at the start", () => {
    const first = fakeStudio(board(["month"]));
    const start = captureStart(first);
    first.change(board(["month", "spotter"], "spotter"));
    const rc = captureEnd(first, start);
    const second = fakeStudio(first.getState()); // remounted with the same board, empty history
    const u = undoRun(second, rc);
    expect(u.ok).toBe(true);
    expect(durable(second.getState())).toBe(durable(board(["month"])));
    expect((second.getState() as { selectedPageId: string }).selectedPageId).toBe("month"); // the removed page isn't left selected
    expect(redoRun(second, rc).ok).toBe(true);
    expect(durable(second.getState())).toBe(durable(board(["month", "spotter"])));
  });

  it("ignores which page is showing when deciding the board is unchanged", () => {
    expect(durable(board(["a", "b"], "a"))).toBe(durable(board(["a", "b"], "b")));
  });

  it("waits while the board is loading", () => {
    const api = fakeStudio(board(["month"]));
    const start = captureStart(api);
    api.change(board(["month", "x"]));
    expect(undoRun(null, captureEnd(api, start)).ok).toBe(false);
  });
});
