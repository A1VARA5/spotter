"use client";
// The AI's receipt, under the board: after every assistant run, what it did according to AG Studio's own
// telemetry (not the model's words): its tool calls with times, money actions (always 0 unless a tool
// outside Spotter's list ran, which turns the line red and flags the run), and board changes with a real
// "Undo what Spotter changed" button backed by Studio's history.
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { boardWords, forServer, helperName, receiptLines, toolWords, type Receipt } from "@/watchtower/receipt";
import { redoRun, undoRun, type BoardApi, type RunChanges } from "@/watchtower/runUndo";

export type BookEntry = { receipt: Receipt; changes: RunChanges | null; said?: string; notKept?: boolean };
/** loadFailed: the receipts kept from earlier visits couldn't be loaded, so the list is this visit only. */
type Snap = { entries: BookEntry[]; running: boolean; loadFailed: boolean; version: number };
export type ReceiptBook = {
  get(): Snap;
  subscribe(fn: () => void): () => void;
  add(e: BookEntry): void;
  /** Receipts kept on the server from earlier visits (no undo for those). */
  seed(rs: Receipt[]): void;
  setRunning(running: boolean): void;
  setLoadFailed(): void;
  touch(): void;
};

const KEEP = 20;

export function createReceiptBook(): ReceiptBook {
  let snap: Snap = { entries: [], running: false, loadFailed: false, version: 0 };
  const subs = new Set<() => void>();
  const emit = (next: Partial<Snap>) => {
    snap = { ...snap, ...next, version: snap.version + 1 };
    for (const fn of subs) fn();
  };
  return {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    add: (e) => emit({ entries: [e, ...snap.entries.filter((x) => x.receipt.runId !== e.receipt.runId)].slice(0, KEEP) }),
    seed(rs) {
      const have = new Set(snap.entries.map((e) => e.receipt.runId));
      emit({ entries: [...snap.entries, ...rs.filter((r) => !have.has(r.runId)).map((receipt) => ({ receipt, changes: null }))].slice(0, KEEP) });
    },
    setRunning: (running) => emit({ running }),
    setLoadFailed: () => emit({ loadFailed: true }),
    touch: () => emit({}),
  };
}

export const useBook = (book: ReceiptBook | undefined) => useSyncExternalStore(book?.subscribe ?? (() => () => {}), book?.get ?? EMPTY_SNAP, EMPTY_SNAP);
const EMPTY: Snap = { entries: [], running: false, loadFailed: false, version: 0 };
function EMPTY_SNAP() {
  return EMPTY;
}

const time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" });
const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const ACCESS: Record<string, string> = { read: "Read only", chat: "Chat only", board: "Board", unknown: "Not on the list" };

/**
 * Sends a finished receipt to the server, in the shape it accepts (a flagged run stays flagged even with odd
 * tool names). Never throws: the receipt is already on screen. If it isn't kept, its entry says so.
 */
export function keepReceipt(book: ReceiptBook, entry: BookEntry) {
  const failed = (why: unknown) => {
    console.warn("[watchtower] receipt wasn't kept:", why);
    entry.notKept = true;
    book.touch();
  };
  fetch("/api/watchtower/receipts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(forServer(entry.receipt)), keepalive: true })
    .then(async (res) => {
      if (!res.ok) failed(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? res.status);
    })
    .catch(failed);
}

/** Adds a finished run to the book and keeps it on the server. */
export function record(book: ReceiptBook, entry: BookEntry) {
  book.add(entry);
  keepReceipt(book, entry);
}

export function ReceiptBar(props: { book: ReceiptBook; api: () => BoardApi | null }) {
  const { entries } = useBook(props.book);
  const latest = entries[0]?.receipt;
  // Always in the page, so a new receipt is announced (a live region added with its text often isn't).
  return (
    <>
      <span className="wt-sr" aria-live="polite">
        {latest && latest.startedAt > LOADED ? `Spotter's receipt: ${receiptLines(latest).summary}` : ""}
      </span>
      <Bar {...props} />
    </>
  );
}
const LOADED = Date.now();

function Bar({ book, api }: { book: ReceiptBook; api: () => BoardApi | null }) {
  const { entries, running } = useBook(book);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  const listId = useId();
  const moreRef = useRef<HTMLButtonElement>(null);
  const entry = entries[0];
  if (!entry && !running) return null;

  if (!entry) {
    return (
      <section className="wt-rc" aria-label="Spotter's receipt" data-state="running">
        <p className="wt-rc-wait">Spotter is working. Its receipt shows here when it&apos;s done.</p>
      </section>
    );
  }

  const r = entry.receipt;
  const lines = receiptLines(r);
  const calls = r.tools.reduce((t, l) => t + l.calls, 0);
  const rc = entry.changes;
  const act = (fn: typeof undoRun) => {
    if (!rc) return;
    let res: { message: string };
    try {
      res = fn(api(), rc);
    } catch (e) {
      console.error("[watchtower] undo or redo failed:", e);
      res = { message: "That didn't work, so nothing was changed back. Remove Spotter's changes by hand, or reset the board." };
    }
    entry.said = res.message;
    setSaid(res.message);
    book.touch();
  };

  return (
    <section
      className="wt-rc"
      aria-label="Spotter's receipt"
      data-flagged={r.flagged || undefined}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        setOpen(false);
        moreRef.current?.focus();
      }}
    >
      <div className="wt-rc-row">
        <p className="wt-rc-title">
          Receipt <span className="wt-rc-when">for your question at {time.format(r.startedAt)}{running ? ", another is running" : ""}</span>
        </p>
        <p className="wt-rc-fact">
          {calls} {calls === 1 ? "call" : "calls"} in {secs(r.ms)}
          {r.status !== "ok" && <span className="wt-rc-status">{r.status === "error" ? ", ended with a problem" : ", stopped"}</span>}
        </p>
        <p className="wt-rc-fact wt-rc-money" data-flagged={r.flagged || undefined}>
          <span className="wt-rc-dot" aria-hidden="true" />
          {r.flagged ? `Money actions: ${r.moneyActions} unchecked` : "Money actions: 0"}
        </p>
        <p className="wt-rc-fact">{boardWords(r).replace(/\.$/, "")}</p>
        <div className="wt-rc-actions">
          {rc && rc.count > 0 && (
            rc.undone ? (
              <button type="button" className="wt-rc-btn" onClick={() => act(redoRun)}>
                Redo Spotter&apos;s changes
              </button>
            ) : (
              <button type="button" className="wt-rc-btn wt-rc-undo" onClick={() => act(undoRun)}>
                Undo what Spotter changed
              </button>
            )
          )}
          <button ref={moreRef} type="button" className="wt-rc-btn wt-rc-more" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide the calls" : "Show the calls"}
          </button>
        </div>
      </div>
      {/* The result of Undo and Redo, said once, politely. */}
      <p className="wt-rc-said" role="status">
        {said && entry.said === said ? said : ""}
      </p>
      <div
        id={listId}
        className="wt-rc-detail"
        hidden={!open}
      >
        <p className={r.flagged ? "wt-rc-alarm" : "wt-rc-note"}>{lines.money}</p>
        <table className="wt-rc-table">
          <caption>What Spotter did, from the AG Studio record of the run</caption>
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Times</th>
              <th scope="col">Took</th>
              <th scope="col">Can touch</th>
            </tr>
          </thead>
          <tbody>
            {r.tools.map((t) => (
              <tr key={t.name} data-access={t.access}>
                <th scope="row">
                  {toolWords(t.name)}
                  {t.failed > 0 && <span className="wt-rc-failed"> ({t.failed} failed)</span>}
                </th>
                <td>{t.calls}</td>
                <td>{t.ms ? secs(t.ms) : "Under 1 ms"}</td>
                <td>{ACCESS[t.access]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.helpers.length > 0 && <p className="wt-rc-note">Handed work to: {r.helpers.map(helperName).join(", ")}.</p>}
        {entry.notKept && <p className="wt-rc-alarm">This receipt couldn&apos;t be kept on the server, so it goes when you leave the page.</p>}
        <p className="wt-rc-note">Names, times and counts only. The receipt never keeps your question, the payees or what the tools returned.</p>
      </div>
    </section>
  );
}
