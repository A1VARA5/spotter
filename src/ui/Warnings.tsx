"use client";
// "A protection was just switched off" (src/core/switchedoff.ts), at the top of the dashboard until the spotter
// says they've seen it. Also sent on their channels; this is the copy that can't get lost.
import { useState } from "react";
import { ShieldOff } from "lucide-react";
import { timeAgo } from "./format";

export type WarningItem = { id: string; text: string; at: string };

export function Warnings({ initial }: { initial: WarningItem[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return null;

  async function seen(id: string) {
    setError(null);
    try {
      const r = await fetch(`/api/warnings/${encodeURIComponent(id)}/seen`, { method: "POST" });
      if (!r.ok && r.status !== 404) throw new Error(`That didn't go through (${r.status}).`);
      setItems((all) => all.filter((w) => w.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    }
  }

  return (
    <section className="warnings" aria-labelledby="warnings-title">
      <h2 id="warnings-title" className="warnings-title">
        <ShieldOff size={18} strokeWidth={2} aria-hidden="true" /> A protection was just switched off
      </h2>
      <ul className="warnings-list">
        {items.map((w) => (
          <li key={w.id}>
            <p>{w.text}</p>
            <p className="warnings-meta">
              {timeAgo(w.at)}
              <button type="button" className="warnings-seen" onClick={() => void seen(w.id)}>
                I&apos;ve dealt with it
              </button>
            </p>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
