"use client";
import { useState } from "react";
import Link from "next/link";
import { HoldTrack } from "@/ui/components";
import { STATE_LABEL, trackState } from "@/ui/format";
import { SCENARIOS, type Scenario } from "@/ui/scenarios";
import type { Payment } from "@/core/lifecycle";
import { readJson } from "@/ui/http";

export type SpenderLite = { id: string; name: string; kind: string };

export function Demo({ spenders }: { spenders: SpenderLite[] }) {
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
        <button className="btn btn-quiet" onClick={reset} disabled={resetting}>
          {resetting ? "Clearing" : "Start fresh"}
        </button>
        {note && (
          <span className="feed-meta" aria-live="polite">
            {note}
          </span>
        )}
      </div>
      <div key={round}>
        {(["agent", "person", "kid"] as const).map((kind) => {
          const spender = spenders.find((p) => p.kind === kind);
          const list = SCENARIOS.filter((s) => s.spender === kind);
          return (
            <section key={kind} className="scen-group" aria-label={spender?.name ?? kind}>
              <h2 className="section-title">{spender?.name ?? (kind === "agent" ? "An AI agent" : kind === "kid" ? "A kid" : "A relative")}</h2>
              <div className="scenarios">
                {list.map((s) => (
                  <ScenarioCard key={s.id} s={s} spender={spender} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ScenarioCard({ s, spender }: { s: Scenario; spender?: SpenderLite }) {
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
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
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
          <p className="feed-meta">Add {s.spender === "agent" ? "an AI agent" : s.spender === "kid" ? "a kid" : "a relative"} to try this one.</p>
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
