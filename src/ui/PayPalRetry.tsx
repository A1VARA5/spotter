"use client";
// A capture or void PayPal didn't confirm. Never a dead end: it says Spotter is retrying (the daily reconcile does it on
// its own) and offers "Try PayPal again" now, which finishes the same request idempotently.
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { paypalPending } from "./format";
import { plainError, readJson } from "./http";
import "./agent-keys.css";

export function PayPalRetry({ p, onDone }: { p: { id: string; status: string; error: string | null }; onDone: () => void }) {
  const pending = paypalPending(p);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!pending) return null;
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`/api/payments/${encodeURIComponent(p.id)}/retry`, { method: "POST" });
      const j = await readJson(r);
      if (r.status === 409) onDone(); // already settled: show where it is now
      else if (!r.ok) setNote(j.error ?? `PayPal still hasn't confirmed (${r.status}). Spotter asks again within a day.`);
      else onDone();
    } catch (e) {
      setNote(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="paypal-retry" role="status">
      <p>{pending.text}</p>
      <button type="button" className="btn btn-quiet" aria-disabled={busy || undefined} onClick={retry}>
        <RefreshCw size={14} strokeWidth={2} aria-hidden="true" className={busy ? "spin" : undefined} />
        {busy ? "Asking PayPal…" : "Try PayPal again"}
      </button>
      {note && <p className="paypal-retry-note">{note}</p>}
    </div>
  );
}
