"use client";
// The simple view's three widgets, for the person Spotter looks out for: big type, one idea each, no ids.
// They read rows through Studio (so the page's "who" filter applies) and Spotter's own reasons from the
// store, and shape them with src/watchtower/gran.ts. Payee names are only ever rendered as plain text.
// When Gran asks Spotter something, the rows it points at glow (data-pointed) until the next question.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import { MAX_TRICKS, granMonth, type GranLabels, type GranRow } from "@/watchtower/gran";
import { gt, type GranLang } from "@/watchtower/granLang";
import { ago, granPointer, type PointKind } from "@/watchtower/point";
import { usePaymentRows, useScrollBox, useWatch, type WatchContext } from "./widgets";

type NoMapping<T extends string> = { type: T; dataMapping: Record<string, never>; format?: AgWidgetDataFormat<unknown> };
export type GranSafeDef = NoMapping<"gran-safe">;
export type GranWaitingDef = NoMapping<"gran-waiting">;
export type GranScamsDef = NoMapping<"gran-scams">;

const FIELDS =["id", "when", "who", "payee", "amount", "outcome", "topSign", "sample", "wasItYou"] as const;
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const FALLBACK: GranLabels = { who: null, viewLabel: "Simple view", waitingTitle: "Waiting for your spotter", spotter: "your spotter" };

/**
 * Is this row one Spotter pointed at? Also scrolls the first lit row into view inside its own tile (never the
 * page, so the answer Gran is reading stays where it is), without the slide when she prefers less motion.
 */
function usePointed(box: RefObject<HTMLElement | null>) {
  const p = useSyncExternalStore(granPointer.onPoint, granPointer.current, () => null);
  useEffect(() => {
    const b = box.current;
    const el = b?.querySelector<HTMLElement>("[data-pointed]");
    if (!b || !el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 12;
    b.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [p, box]);
  return (kind: PointKind, rowId?: string) => !!p?.items.some((i) => i.kind === kind && (rowId === undefined || i.rowId === rowId));
}
/** A lit row glows and becomes a tab stop, so a keyboard user can reach what Spotter pointed at. */
const lit = (on: boolean) => (on ? { "data-pointed": "", tabIndex: 0 } : {});

/** This month for the person, from Studio's rows (page filters applied) and Spotter's notes. */
function useGranMonth(p: AgWidgetParams<never>) {
  const snap = useWatch(p.context);
  const labels = (p.context as WatchContext | undefined)?.gran ?? FALLBACK;
  const lang: GranLang = (p.context as WatchContext | undefined)?.granLang ?? "en";
  const { rows, failed } = usePaymentRows(p, FIELDS, snap.version);
  const [now] = useState(() => Date.now());
  // A row with no usable amount or date can't be added up honestly: say so rather than count it as £0.
  const clean = rows?.map((r) => ({ ...r, when: r.when instanceof Date ? r.when : new Date(String(r.when)), amount: Number(r.amount) }) as GranRow);
  const bad = clean?.filter((r) => !Number.isFinite(r.amount) || !Number.isFinite(r.when.getTime())) ?? [];
  if (bad.length) console.error("[watchtower] simple view got payments without a usable amount or date:", bad.map((r) => r.id));
  // Studio has already applied the page or widget filter (the simple board filters to the person), so
  // the rows are the right ones whoever the widget is focused on: no second filter by name here.
  const month = clean && !bad.length ? granMonth(clean, snap.notes, { who: null, spotter: labels.spotter, now: new Date(now), lang }) : null;
  return { month, failed: failed || bad.length > 0, labels, now, lang };
}

const Sample = ({ on, lang }: { on: boolean; lang: GranLang }) => (on ? <span className="gran-sample">{gt(lang, "sample")}</span> : null);
const Failed = ({ lang, spotter }: { lang: GranLang; spotter: string }) => <p className="gran-failed">{gt(lang, "failed", { spotter })}</p>;

export function GranSafeWidget(p: AgWidgetParams<GranSafeDef>) {
  const { month, failed, now, lang, labels } = useGranMonth(p as never);
  const box = useRef<HTMLElement>(null);
  const scroll = useScrollBox<HTMLElement>(box);
  const pointed = usePointed(box);
  if (failed) return <Failed lang={lang} spotter={labels.spotter} />;
  if (!month) return null;
  return (
    <section className="gran gran-safe" aria-labelledby="gran-safe-h" {...scroll}>
      <h2 id="gran-safe-h" className="gran-h">
        {gt(lang, "safeTitle")}
      </h2>
      {month.stopped.length ? (
        <>
          {/* Her own money and the made up sample month's are never one number. */}
          {month.kept > 0 || !month.keptSample ? (
            <p className="gran-statement" {...lit(pointed("kept"))}>
              {gt(lang, "keptBefore")}
              <span className="gran-money">{gbp.format(month.kept)}</span>
              {gt(lang, "keptAfter")}
            </p>
          ) : (
            <p className="gran-statement" {...lit(pointed("kept"))}>
              {gt(lang, "keptBeforeSample")}
              <span className="gran-money">{gbp.format(month.keptSample)}</span>
              {gt(lang, "keptAfterSample")} <Sample on lang={lang} />
            </p>
          )}
          {month.kept > 0 && month.keptSample > 0 && (
            <p className="gran-sample-sum">
              {gt(lang, "keptPlusSample", { amount: gbp.format(month.keptSample) })} <Sample on lang={lang} />
            </p>
          )}
          <ul className="gran-list">
            {month.stopped.map((s) => (
              <li key={s.id} className="gran-item" {...lit(pointed("stop", s.id))}>
                <p className="gran-item-head">
                  <span className="gran-stop" aria-hidden="true" />
                  <span className="gran-amount">{gbp.format(s.amount)}</span>
                  <span>
                    {gt(lang, "to")} <span className="gran-payee">{s.payee}</span>
                  </span>
                  <Sample on={s.sample} lang={lang} />
                  {s.example && !s.sample && <span className="gran-sample">{gt(lang, "example")}</span>}
                </p>
                <p className="gran-item-body">{s.sentence}</p>
                <p className="gran-item-meta">
                  {s.by}. {ago(s.when, now, lang)}.{s.times > 1 ? ` ${gt(lang, "tries", { n: s.times })}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="gran-statement" {...lit(pointed("kept"))}>
          {gt(lang, "safeNone")}
        </p>
      )}
    </section>
  );
}

export function GranWaitingWidget(p: AgWidgetParams<GranWaitingDef>) {
  const { month, failed, labels, now, lang } = useGranMonth(p as never);
  const box = useRef<HTMLElement>(null);
  const scroll = useScrollBox<HTMLElement>(box);
  const pointed = usePointed(box);
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
      // The server's message is in English; in another language Spotter's own fixed words say the same.
      setSlept((s) => ({ ...s, [id]: lang === "en" ? `Sleeping on it. ${j.message ?? "Spotter asks again tomorrow."}` : gt(lang, "sleptFallback") }));
    } catch (e) {
      console.warn("[watchtower] ask again tomorrow failed:", e);
      setSleepError((s) => ({ ...s, [id]: lang === "en" && e instanceof Error ? e.message : gt(lang, "sleepFailed", { spotter: labels.spotter }) }));
    } finally {
      setBusy(null);
    }
  }
  if (failed) return <Failed lang={lang} spotter={labels.spotter} />;
  if (!month) return null;
  return (
    <section className="gran gran-waiting" aria-labelledby="gran-waiting-h" {...scroll}>
      <h2 id="gran-waiting-h" className="gran-h">
        {gt(lang, "waitingTitle", { spotter: labels.spotter })}
      </h2>
      {month.waiting.length ? (
        <>
          <p className="gran-statement">
            {month.waiting.length === 1 ? gt(lang, "waitingOne") : gt(lang, "waitingMany", { n: month.waiting.length })}
          </p>
          <ul className="gran-list">
            {month.waiting.map((w) => (
              <li key={w.id} className="gran-item" {...lit(pointed("wait", w.id))}>
                <div className="gran-track" aria-hidden="true">
                  <span className="gran-line" />
                  <span className="gran-clamp">{gbp.format(w.amount)}</span>
                  <span className="gran-line gran-line-ahead" />
                </div>
                <p className="gran-item-head">
                  <span className="gran-amount gran-sr">{gbp.format(w.amount)}</span>
                  <span>
                    {gt(lang, "toCap")} <span className="gran-payee">{w.payee}</span>
                  </span>
                  <Sample on={w.sample} lang={lang} />
                </p>
                <p className="gran-item-body">{slept[w.id] ?? w.status}</p>
                {w.ends && <p className="gran-item-body">{w.ends}</p>}
                <p className="gran-item-meta">{gt(lang, "asked", { ago: ago(w.when, now, lang).toLocaleLowerCase(lang) })}</p>
                {!w.asleep && !w.sample && !slept[w.id] && (
                  <button type="button" className="gran-sleep" aria-disabled={busy === w.id || undefined} onClick={() => void sleepOn(w.id)}>
                    {busy === w.id ? gt(lang, "sleepSaving") : gt(lang, "sleepButton")}
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
        <p className="gran-statement">{gt(lang, "waitingNone")}</p>
      )}
    </section>
  );
}

export function GranScamsWidget(p: AgWidgetParams<GranScamsDef>) {
  const { month, failed, lang, labels } = useGranMonth(p as never);
  const box = useRef<HTMLElement>(null);
  const scroll = useScrollBox<HTMLElement>(box);
  const pointed = usePointed(box);
  if (failed) return <Failed lang={lang} spotter={labels.spotter} />;
  if (!month) return null;
  return (
    <section className="gran gran-scams" aria-labelledby="gran-scams-h" {...scroll}>
      <h2 id="gran-scams-h" className="gran-h">
        {gt(lang, "scamsTitle")}
      </h2>
      {/* The advice first: it's the one thing to remember. Then the tricks, most common first. */}
      <div className="gran-scams-cols">
        <div className="gran-warning" {...lit(pointed("advice"))}>
          <span className="gran-warning-icon" aria-hidden="true">
            !
          </span>
          <p>
            <span className="gran-sr">{gt(lang, "adviceSr")}</span>
            <strong>{gt(lang, "adviceLead")}</strong> {gt(lang, "advice")}
          </p>
        </div>
        {month.tricks.length ? (
          <ul className="gran-tricks" aria-label={gt(lang, "tricksLabel")}>
            {month.tricks.slice(0, MAX_TRICKS).map((t) => (
              <li key={t.sign} {...lit(pointed("trick", t.sign))}>
                <span className="gran-trick">{t.plain}</span> <span className="gran-times">{t.count === 1 ? gt(lang, "once") : gt(lang, "times", { n: t.count })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gran-statement">{gt(lang, "noTricks")}</p>
        )}
      </div>
    </section>
  );
}
