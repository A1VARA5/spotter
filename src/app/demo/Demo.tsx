"use client";
import { useState } from "react";
import Link from "next/link";
import { HoldTrack } from "@/ui/components";
import { STATE_LABEL, trackState } from "@/ui/format";
import { SCENARIOS, type Scenario } from "@/ui/scenarios";
import type { Payment } from "@/core/lifecycle";
import { readJson } from "@/ui/http";

export function Demo() {
  const [round, setRound] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function reset() {
    setResetting(true);
    try {
      const r = await fetch("/api/demo/reset", { method: "POST" });
      if (r.status === 401) {
        setNote("Only the spotter can start fresh. Unlock with the PIN on the dashboard first.");
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
      <div className="scenarios" key={round}>
        {SCENARIOS.map((s) => (
          <ScenarioCard key={s.id} s={s} />
        ))}
      </div>
    </>
  );
}

function ScenarioCard({ s }: { s: Scenario }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch("/api/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s.body) });
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
        <HoldTrack state={state} from={s.who} to={s.body.payee} amount={s.body.amount} currency={s.body.currency} />
      )}
      {result ? (
        <p aria-live="polite">
          <strong>{STATE_LABEL[trackState(result.status)]}.</strong>{" "}
          {result.status === "needs_approval" ? (
            <Link href="/dashboard">Open the dashboard to decide</Link>
          ) : (
            (result.status === "failed" ? result.error : result.decision?.reasons[0]) ?? "Within the rules and nothing suspicious."
          )}
        </p>
      ) : (
        <p className="scenario-body">Expected: {s.expect}</p>
      )}
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="btn btn-quiet" onClick={run} disabled={running}>
          {running ? "Checking" : result ? "Run again" : "Run this"}
        </button>
      </div>
    </article>
  );
}
