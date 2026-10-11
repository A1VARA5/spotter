// "Undo what Spotter changed": roll back exactly the board changes one assistant run made, with AG Studio's
// own history (getHistory, undo(id), redo(id)). Studio records the AI's tool changes and setState calls as
// history entries (checked in the running app), so the run's entries are the ones added between its start
// and its end. History is per Studio instance: after a live remount the ids mean nothing, so the fallback
// is the board as it was when the run started, restored with setState, and only while the board is still
// exactly as the run left it, so a change the family made since is never thrown away.
import type { AgReportHistory, AgReportState } from "ag-studio";
import { newEntryIds, redoTarget, undoTarget } from "./receipt";

export type BoardApi = {
  getState(): AgReportState;
  setState(state: AgReportState): void;
  getHistory(): Pick<AgReportHistory, "undo" | "redo">;
  undo(toEntryId?: string): void;
  redo(toEntryId?: string): void;
};
export type RunStartSnapshot = { ids: string[]; state: AgReportState };
export type RunChanges = {
  api: BoardApi;
  ids: string[];
  before: AgReportState;
  after: AgReportState;
  count: number;
  undone: boolean;
};
export type UndoResult = { ok: boolean; message: string };

/** The document part of a board (pages, widgets, filters), without which page is showing or panel state. */
export function durable(state: AgReportState): string {
  const { selectedPageId: _p, panels: _q, ...doc } = state as AgReportState & { selectedPageId?: unknown; panels?: unknown };
  return JSON.stringify(doc);
}

export function captureStart(api: BoardApi): RunStartSnapshot {
  return { ids: api.getHistory().undo.map((e) => e.id), state: api.getState() };
}

export function captureEnd(api: BoardApi, start: RunStartSnapshot): RunChanges {
  const ids = newEntryIds(start.ids, api.getHistory().undo);
  const after = api.getState();
  // Changes that left no history entry (shouldn't happen in 3.0) still count once if the board differs.
  const count = ids.length || (durable(start.state) !== durable(after) ? 1 : 0);
  return { api, ids, before: start.state, after, count, undone: false };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const back = (n: number) => `Redone: ${n === 1 ? "Spotter's change is" : `Spotter's ${n} changes are`} back.`;
const BLOCKED = "The board has changed since, so undoing would lose those changes too. Remove what Spotter added by hand, or reset the board.";

export function undoRun(current: BoardApi | null, rc: RunChanges): UndoResult {
  if (!current) return { ok: false, message: "The board is still loading. Try again in a moment." };
  if (rc.undone) return { ok: false, message: "Already undone." };
  if (!rc.count) return { ok: false, message: "Spotter didn't change the board in that run." };
  if (current === rc.api && rc.ids.length) {
    const target = undoTarget(rc.ids, current.getHistory());
    if (target) {
      current.undo(target);
      rc.undone = true;
      return { ok: true, message: `Undone: ${plural(rc.count, "change")} Spotter made. The board is back as it was before you asked.` };
    }
  }
  if (durable(current.getState()) !== durable(rc.after)) return { ok: false, message: BLOCKED };
  current.setState({ ...rc.before, selectedPageId: pageOr(rc.before, current.getState().selectedPageId) } as AgReportState);
  rc.undone = true;
  return { ok: true, message: `Undone: ${plural(rc.count, "change")} Spotter made. The board is back as it was before you asked.` };
}

export function redoRun(current: BoardApi | null, rc: RunChanges): UndoResult {
  if (!current) return { ok: false, message: "The board is still loading. Try again in a moment." };
  if (!rc.undone) return { ok: false, message: "Nothing to redo." };
  if (current === rc.api && rc.ids.length) {
    const target = redoTarget(rc.ids, current.getHistory());
    if (target) {
      current.redo(target);
      rc.undone = false;
      return { ok: true, message: back(rc.count) };
    }
  }
  if (durable(current.getState()) !== durable(rc.before)) return { ok: false, message: "The board has changed since, so Spotter's changes can't be put back without losing yours." };
  current.setState(rc.after);
  rc.undone = false;
  return { ok: true, message: back(rc.count) };
}

/** Keep showing the current page when it still exists in the restored board, else the board's own. */
function pageOr(state: AgReportState, id: string | undefined): string | undefined {
  const pages = (state as { pages?: Array<{ id: string }> }).pages ?? [];
  return id && pages.some((p) => p.id === id) ? id : (state as { selectedPageId?: string }).selectedPageId;
}
