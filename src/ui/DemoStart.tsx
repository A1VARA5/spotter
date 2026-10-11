"use client";
// "Try it on fake money": a plain form post (works without JavaScript), that says it's busy the moment it's clicked.
// Making the demo family takes about 3 seconds (it puts a real sandbox hold in place), and a button that sits still
// for that long gets clicked again.
import { useEffect, useState } from "react";

export function DemoStart({ label, className = "btn btn-hold" }: { label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  // Coming back with the browser's Back button restores the page from cache: the button works again.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
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
