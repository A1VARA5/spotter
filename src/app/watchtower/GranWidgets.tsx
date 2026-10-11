"use client";
// The simple view's three widgets, for the person Spotter looks out for: big type, one idea each, no ids.
// They read rows through Studio (so the page's "who" filter applies) and Spotter's own reasons from the
// store, and shape them with src/watchtower/gran.ts. Payee names are only ever rendered as plain text.
import { useState } from "react";
import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { ADVICE, granMonth, type GranLabels, type GranRow } from "@/watchtower/gran";
import { usePaymentRows, useScrollBox, useWatch, type WatchContext } from "./widgets";

type NoMapping<T extends string> = { type: T; dataMapping: Record<string, never>; format?: AgWidgetDataFormat<unknown> };
export type GranSafeDef = NoMapping<"gran-safe">;
export type GranWaitingDef = NoMapping<"gran-waiting">;
export type GranScamsDef = NoMapping<"gran-scams">;

const MAX_TRICKS = 3;
const FIELDS =["id", "when", "who", "payee", "amount", "outcome", "topSign", "sample"] as const;
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const FALLBACK: GranLabels = { who: null, viewLabel: "Simple view", waitingTitle: "Waiting for your spotter", spotter: "your spotter" };

function ago(when: Date, now: number): string {
  const h = Math.floor((now - when.getTime()) / 3600_000);
  if (h < 1) return "Just now";
  if (h < 24) return h === 1 ? "An hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

/** This month for the person, from Studio's rows (page filters applied) and Spotter's notes. */
function useGranMonth(p: AgWidgetParams<never>) {
  const snap = useWatch(p.context);
  const labels = (p.context as WatchContext | undefined)?.gran ?? FALLBACK;
  const { rows, failed } = usePaymentRows(p, FIELDS, snap.version);
  const [now] = useState(() => Date.now());
  // A row with no usable amount or date can't be added up honestly: say so rather than count it as £0.
  const clean = rows?.map((r) => ({ ...r, when: r.when instanceof Date ? r.when : new Date(String(r.when)), amount: Number(r.amount) }) as GranRow);
  const bad = clean?.filter((r) => !Number.isFinite(r.amount) || !Number.isFinite(r.when.getTime())) ?? [];
  if (bad.length) console.error("[watchtower] simple view got payments without a usable amount or date:", bad.map((r) => r.id));
  // Studio has already applied the page or widget filter (the simple board filters to the person), so
  // the rows are the right ones whoever the widget is focused on: no second filter by name here.
  const month = clean && !bad.length ? granMonth(clean, snap.notes, { who: null, spotter: labels.spotter, now: new Date(now) }) : null;
  return { month, failed: failed || bad.length > 0, labels, now };
}

const Sample = ({ on }: { on: boolean }) => (on ? <span className="gran-sample">Sample</span> : null);
const Failed = () => <p className="gran-failed">This part didn&apos;t load. Reload the page, or ask your spotter.</p>;

export function GranSafeWidget(p: AgWidgetParams<GranSafeDef>) {
  const { month, failed, now } = useGranMonth(p as never);
  const scroll = useScrollBox<HTMLElement>();
  if (failed) return <Failed />;
  if (!month) return null;
  return (
    <section className="gran gran-safe" aria-labelledby="gran-safe-h" {...scroll}>
      <h2 id="gran-safe-h" className="gran-h">
        Your money is safe
      </h2>
      {month.stopped.length ? (
        <>
          <p className="gran-statement">
            Spotter kept <span className="gran-money">{gbp.format(month.kept)}</span> away from scammers this month.
          </p>
          <ul className="gran-list">
            {month.stopped.map((s) => (
              <li key={s.id} className="gran-item">
                <p className="gran-item-head">
                  <span className="gran-stop" aria-hidden="true" />
                  <span className="gran-amount">{gbp.format(s.amount)}</span>
                  <span>
                    to <span className="gran-payee">{s.payee}</span>
                  </span>
                  <Sample on={s.sample} />
                </p>
                <p className="gran-item-body">{s.sentence}</p>
                <p className="gran-item-meta">
                  {s.by}. {ago(s.when, now)}.
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="gran-statement">Nothing needed stopping this month. Spotter checks every payment for you.</p>
      )}
    </section>
  );
}

export function GranWaitingWidget(p: AgWidgetParams<GranWaitingDef>) {
  const { month, failed, labels, now } = useGranMonth(p as never);
  const scroll = useScrollBox<HTMLElement>();
  // "Ask again tomorrow" only makes the hold wait a day: it never pays or releases anything, so Gran can choose it too.
  const [slept, setSlept] = useState<Record<string, string>>({});
  const [sleepError, setSleepError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  async function sleepOn(id: string) {
    if (busy) return;
    setBusy(id);
    setSleepError((e) => ({ ...e, [id]: "" }));
    try {
      const r = await fetch(`/api/payments/${encodeURIComponent(id)}/sleep`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ as: "person" }) });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `That didn't work (${r.status}).`);
      setSlept((s) => ({ ...s, [id]: `Sleeping on it. ${j.message ?? "Spotter asks again tomorrow."}` }));
    } catch (e) {
      setSleepError((s) => ({ ...s, [id]: e instanceof Error ? e.message : "That didn't work. Try again, or ask your spotter." }));
    } finally {
      setBusy(null);
    }
  }
  if (failed) return <Failed />;
  if (!month) return null;
  return (
    <section className="gran gran-waiting" aria-labelledby="gran-waiting-h" {...scroll}>
      <h2 id="gran-waiting-h" className="gran-h">
        {labels.waitingTitle}
      </h2>
      {month.waiting.length ? (
        <>
          <p className="gran-statement">
            {month.waiting.length === 1 ? "One payment is" : `${month.waiting.length} payments are`} waiting. You don&apos;t need to do anything.
          </p>
          <ul className="gran-list">
            {month.waiting.map((w) => (
              <li key={w.id} className="gran-item">
                <div className="gran-track" aria-hidden="true">
                  <span className="gran-line" />
                  <span className="gran-clamp">{gbp.format(w.amount)}</span>
                  <span className="gran-line gran-line-ahead" />
                </div>
                <p className="gran-item-head">
                  <span className="gran-amount gran-sr">{gbp.format(w.amount)}</span>
                  <span>
                    To <span className="gran-payee">{w.payee}</span>
                  </span>
                  <Sample on={w.sample} />
                </p>
                <p className="gran-item-body">{slept[w.id] ?? w.status}</p>
                {w.ends && <p className="gran-item-body">{w.ends}</p>}
                <p className="gran-item-meta">Asked {ago(w.when, now).toLowerCase()}.</p>
                {!w.asleep && !w.sample && !slept[w.id] && (
                  <button type="button" className="gran-sleep" aria-disabled={busy === w.id || undefined} onClick={() => void sleepOn(w.id)}>
                    {busy === w.id ? "Saving…" : "Not sure? Ask again tomorrow"}
                  </button>
                )}
                {sleepError[w.id] && (
                  <p className="gran-failed" role="alert">
                    {sleepError[w.id]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="gran-statement">Nothing is waiting. Payments that look fine go straight through.</p>
      )}
    </section>
  );
}

export function GranScamsWidget(p: AgWidgetParams<GranScamsDef>) {
  const { month, failed } = useGranMonth(p as never);
  const scroll = useScrollBox<HTMLElement>();
  if (failed) return <Failed />;
  if (!month) return null;
  return (
    <section className="gran gran-scams" aria-labelledby="gran-scams-h" {...scroll}>
      <h2 id="gran-scams-h" className="gran-h">
        Things that looked like scams
      </h2>
      {/* The advice first: it's the one thing to remember. Then the tricks, most common first. */}
      <div className="gran-scams-cols">
        <div className="gran-warning">
          <span className="gran-warning-icon" aria-hidden="true">
            !
          </span>
          <p>
            <span className="gran-sr">Advice: </span>
            <strong>If anyone asks you for money:</strong> {ADVICE}
          </p>
        </div>
        {month.tricks.length ? (
          <ul className="gran-tricks" aria-label="Tricks scammers tried this month">
            {month.tricks.slice(0, MAX_TRICKS).map((t) => (
              <li key={t.sign}>
                <span className="gran-trick">{t.plain}</span> <span className="gran-times">{t.count === 1 ? "Once" : `${t.count} times`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gran-statement">No scam tricks this month.</p>
        )}
      </div>
    </section>
  );
}
