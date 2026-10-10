"use client";
import { useState } from "react";
import Link from "next/link";
import { HoldTrack } from "@/ui/components";
import { STATE_LABEL, trackState } from "@/ui/format";
import { scenariosFor, type Scenario } from "@/ui/scenarios";
import { labelsFor, type Labels } from "@/ui/labels";
import type { HouseholdKind } from "@/core/households";
import type { Payment } from "@/core/lifecycle";
import { plainError, readJson } from "@/ui/http";
import { Confirm } from "@/ui/Confirm";

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

function ScenarioCard({ s, spender, labels }: { s: Scenario; spender?: SpenderLite; labels: Labels }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!spender) return;
    setRunning(true);
    setError(null);
    try {
      const r = await fetch("/api/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s.body, spenderId: spender.id }) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}).`);
      setResult(j.payment);
    } catch (e) {
      setError(plainError(e));
    } finally {
      setRunning(false);
    }
  }

  const state = result ? trackState(result.status) : running ? "checking" : null;
  return (
    <article className="scenario" aria-labelledby={`s-${s.id}`}>
      <h2 id={`s-${s.id}`} className="scenario-title">
        {s.title}
      </h2>
      <p className="scenario-body">{s.blurb}</p>
      {state && (
        <HoldTrack state={state} from={spender?.name ?? s.who} to={s.body.payee} amount={s.body.amount} currency={s.body.currency} />
      )}
      {result ? (
        <Outcome p={result} onAgain={run} running={running} />
      ) : (
        <p className="scenario-body">Expected: {s.expect}</p>
      )}
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
      <div>
        {spender ? (
          !result && (
            <button className="btn btn-quiet" onClick={run} disabled={running}>
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

/** The outcome in one line, and the one sensible next step for it. */
function Outcome({ p, onAgain, running }: { p: Payment; onAgain: () => void; running: boolean }) {
  const s = trackState(p.status);
  const why = (s === "failed" ? p.error : p.decision?.reasons[0]) ?? "Within the rules, and nothing looked wrong.";
  const tone = s === "held" ? "held" : s === "paid" ? "paid" : "stop";
  return (
    <div className="scen-result" data-tone={tone} aria-live="polite">
      <p>
        <strong>{s === "held" ? "Waiting for you." : `${STATE_LABEL[s]}.`}</strong> {s === "held" ? "PayPal is holding the money until you approve or deny it." : why}
      </p>
      <div className="scen-next">
        {s === "held" ? (
          <Link className="btn btn-primary" href="/dashboard">
            Review it now
          </Link>
        ) : (
          <Link className="btn btn-quiet" href="/ledger">
            {s === "paid" ? "See it in Activity" : "See the full reasons"}
          </Link>
        )}
        <button className="scen-again" onClick={onAgain} disabled={running}>
          {running ? "Checking" : "Send it again"}
        </button>
      </div>
    </div>
  );
}
