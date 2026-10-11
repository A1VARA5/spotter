"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HoldTrack } from "@/ui/components";
import { trackState } from "@/ui/format";
import { JUDGE_TOUR, SCENARIOS, scenariosFor, type Scenario } from "@/ui/scenarios";
import { labelsFor, OUTCOME_WORDS, type Labels } from "@/ui/labels";
import type { HouseholdKind } from "@/core/households";
import type { Payment } from "@/core/lifecycle";
import { plainError, readJson } from "@/ui/http";
import { Confirm } from "@/ui/Confirm";
import "./demo.css";

export type SpenderLite = { id: string; name: string; kind: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Demo({ spenders, kind = "family" }: { spenders: SpenderLite[]; kind?: HouseholdKind }) {
  const labels = labelsFor(kind);
  const { main, extra } = scenariosFor(kind);
  // One group per person, in the order the scenarios list them (families: agent, Gran, Leo; a business: staff first).
  const groups = [...new Set(main.map((s) => s.spender))];
  const [round, setRound] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function reset() {
    setResetting(true);
    try {
      const r = await fetch("/api/demo/reset", { method: "POST" });
      if (r.status === 401) {
        setNote("Unlock with your PIN on the dashboard first.");
        return;
      }
      if (!r.ok) throw new Error();
      const { cleared } = await readJson(r);
      setNote(cleared ? `Cleared ${cleared} payments. Allowances are full again.` : "Already fresh.");
      setRound((n) => n + 1);
    } catch {
      setNote("Couldn't reset. Try again in a moment.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <div className="demo-bar">
        <Confirm
          trigger={resetting ? "Clearing" : "Start fresh"}
          disabled={resetting}
          title="Start fresh?"
          body="This clears every payment in this family, so allowances are full again. Holds already at PayPal simply expire. It can't be undone."
          confirmLabel="Clear payments"
          onConfirm={reset}
        />
        <span className="feed-meta" aria-live="polite">
          {note ?? "Send them in any order. Payments you send use up this week's allowance, so after lots of sends, Start fresh fills it up again."}
        </span>
      </div>
      <div key={round}>
        {groups.map((who) => {
          const spender = spenders.find((p) => p.kind === who);
          const list = main.filter((s) => s.spender === who);
          const fallback = cap(labels.addWho[who]);
          return (
            <section key={who} className="scen-group" aria-label={spender?.name ?? fallback}>
              <h2 className="section-title">{spender?.name ?? fallback}</h2>
              <div className="scenarios">
                {list.map((s) => (
                  <ScenarioCard key={s.id} s={s} spender={spender} labels={labels} />
                ))}
              </div>
            </section>
          );
        })}
        {extra.length > 0 && (
          <section className="scen-group scen-business" aria-labelledby="scen-business">
            <h2 id="scen-business" className="section-title">
              Runs a business?
            </h2>
            <p className="scen-group-note">
              Same Spotter, different people: staff paying suppliers and AI buying agents ordering stock. Here{" "}
              {spenders.find((p) => p.kind === "person")?.name ?? "your relative"} forwards the invoice and{" "}
              the {spenders.find((p) => p.kind === "agent")?.name.toLowerCase() ?? "agent"} places the order.
            </p>
            <div className="scenarios">
              {extra.map((s) => (
                <ScenarioCard key={s.id} s={s} spender={spenders.find((p) => p.kind === s.spender)} labels={labels} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** Sends one scenario through Spotter as that person, for a scenario card and the judge's tour alike. */
function useSend(s: Scenario, spender?: SpenderLite) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each finished send, so focus moves to the new result even when the outcome is the same.
  const [sent, setSent] = useState(0);
  const next = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (sent) next.current?.focus();
  }, [sent]);

  async function run() {
    // The button stays focusable while checking (aria-disabled), so ignore repeat presses here instead.
    if (!spender || running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await fetch("/api/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s.body, spenderId: spender.id }) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}).`);
      setResult(j.payment);
      setSent((n) => n + 1);
    } catch (e) {
      setError(plainError(e));
    } finally {
      setRunning(false);
    }
  }
  return { running, result, error, next, run };
}

/** Four buttons at the top of Try: the demos that show the most, without scrolling for them. */
export function JudgeTour({ spenders }: { spenders: SpenderLite[] }) {
  const stops = JUDGE_TOUR.map((t) => ({ t, s: SCENARIOS.find((x) => x.id === t.id) })).filter((x): x is { t: (typeof JUDGE_TOUR)[number]; s: Scenario } => Boolean(x.s));
  return (
    <section className="tour" aria-labelledby="tour-title">
      <h2 id="tour-title" className="tour-title">
        Short on time? Start with these four
      </h2>
      <ul className="tour-list">
        {stops.map(({ t, s }) => (
          <TourStop key={t.id} short={t.short} shows={t.shows} s={s} spender={spenders.find((p) => p.kind === s.spender)} />
        ))}
      </ul>
    </section>
  );
}

function TourStop({ short, shows, s, spender }: { short: string; shows: string; s: Scenario; spender?: SpenderLite }) {
  const { running, result, error, next, run } = useSend(s, spender);
  const state = result ? trackState(result.status) : null;
  return (
    <li className="tour-stop" data-state={state ?? undefined}>
      <p className="tour-name">{short}</p>
      <p className="tour-shows">Shows {shows}</p>
      {result && state ? (
        <>
          <p className="tour-out">{OUTCOME_WORDS[state].long}.</p>
          <Link ref={next} className="btn btn-primary tour-btn" href={state === "paid" ? "/ledger" : `/dashboard#pay-${result.id}`}>
            {state === "held" ? "Review it now" : state === "paid" ? "See it in Activity" : "See why"}
          </Link>
        </>
      ) : spender ? (
        <button type="button" className="btn btn-quiet tour-btn" onClick={run} aria-disabled={running || undefined} aria-label={running ? `Checking: ${short}` : `Send it: ${short}`}>
          {running ? "Checking" : "Send it"}
        </button>
      ) : (
        <p className="tour-shows">Needs {s.who} in the family.</p>
      )}
      <p className="sr-only" role="status">
        {running ? `Checking ${short}.` : result ? outcomeLine(result) : ""}
      </p>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function ScenarioCard({ s, spender, labels }: { s: Scenario; spender?: SpenderLite; labels: Labels }) {
  const { running, result, error, next, run } = useSend(s, spender);
  const state = result ? trackState(result.status) : running ? "checking" : null;
  return (
    <article className="scenario" aria-labelledby={`s-${s.id}`}>
      <h3 id={`s-${s.id}`} className="scenario-title">
        {s.title}
      </h3>
      <p className="scenario-body">{s.blurb}</p>
      {s.shows && (
        <ul className="scen-shows" aria-label="What this one shows">
          {s.shows.map((t) => (
            <li key={t.engine + t.what} className="scen-show">
              Shows: <b>{t.engine}</b> {t.what}
            </li>
          ))}
        </ul>
      )}
      {state && (
        <HoldTrack state={state} from={spender?.name ?? s.who} to={s.body.payee} amount={s.body.amount} currency={s.body.currency} />
      )}
      {result ? (
        <Outcome p={result} onAgain={run} running={running} nextRef={next} />
      ) : (
        <p className="scenario-body">Expected: {s.expect}</p>
      )}
      {/* Always in the page, so screen readers hear the change when the text arrives. */}
      <p className="sr-only" role="status">
        {running ? `Checking ${s.title}.` : result ? outcomeLine(result) : ""}
      </p>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
      <div>
        {spender ? (
          !result && (
            <button className="btn btn-quiet" onClick={run} aria-disabled={running || undefined}>
              {running ? "Checking" : "Send it"}
            </button>
          )
        ) : (
          <p className="feed-meta">Add {labels.addWho[s.spender]} to try this one.</p>
        )}
      </div>
    </article>
  );
}

/** The outcome in the app's own words (labels.ts): the status, then the reason or the plain sentence for it. */
function outcomeParts(p: Payment): [string, string] {
  const s = trackState(p.status);
  const why = s === "failed" ? p.error : s === "held" ? OUTCOME_WORDS.held.explain : p.decision?.reasons[0];
  return [OUTCOME_WORDS[s].long, why ?? OUTCOME_WORDS[s].explain];
}

function outcomeLine(p: Payment) {
  const [status, why] = outcomeParts(p);
  return `${status}. ${why}`;
}

/** The outcome in one line, and the one sensible next step for it. */
function Outcome({ p, onAgain, running, nextRef }: { p: Payment; onAgain: () => void; running: boolean; nextRef: React.Ref<HTMLAnchorElement> }) {
  const s = trackState(p.status);
  const [status, why] = outcomeParts(p);
  const tone = s === "held" ? "held" : s === "paid" ? "paid" : "stop";
  return (
    <div className="scen-result" data-tone={tone}>
      <p>
        <strong>{status}.</strong> {why}
      </p>
      <div className="scen-next">
        {s === "held" ? (
          <Link ref={nextRef} className="btn btn-primary" href={`/dashboard#pay-${p.id}`}>
            Review it now
          </Link>
        ) : (
          <Link ref={nextRef} className="btn btn-quiet" href={s === "paid" ? "/ledger" : `/dashboard#pay-${p.id}`}>
            {s === "paid" ? "See it in Activity" : "See the full reasons"}
          </Link>
        )}
        <button className="scen-again" onClick={onAgain} aria-disabled={running || undefined}>
          {running ? "Checking" : "Send it again"}
        </button>
      </div>
    </div>
  );
}
