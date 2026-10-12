"use client";
// "Try it on fake money": a plain form post (works without JavaScript), that says it's busy the moment it's clicked.
// Making the demo family takes about 3 seconds (it puts a real sandbox hold in place), and a button that sits still
// for that long gets clicked again. Every way into the demo uses this one label, so there is one name for it site wide.
import { useEffect, useState } from "react";

export const DEMO_CTA = "Try it on fake money";

export function DemoStart({ className = "btn btn-hold" }: { className?: string }) {
  const label = DEMO_CTA;
  const [busy, setBusy] = useState(false);
  // Coming back with the browser's Back button restores the page from cache: the button works again.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  // A stopped or hung request leaves the page where it is: after 20 seconds the button can be pressed again.
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 20_000);
    return () => clearTimeout(t);
  }, [busy]);
  return (
    <form
      action="/api/demo/start"
      method="post"
      onSubmit={(e) => {
        if (busy) e.preventDefault();
        else setBusy(true);
      }}
    >
      <button className={className} aria-disabled={busy || undefined} data-busy={busy || undefined}>
        {busy ? (
          <>
            <span className="btn-spin" aria-hidden="true" />
            Making your demo family
          </>
        ) : (
          label
        )}
      </button>
      <span className="sr-only" role="status">
        {busy ? "Making your demo family. This takes a few seconds." : ""}
      </span>
    </form>
  );
}
