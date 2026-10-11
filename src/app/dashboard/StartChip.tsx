"use client";
// Getting started as one slim line: how far along you are, the next step as a link, and a way to hide it.
// Hiding sets a cookie the server reads, so the chip never flashes back on the next visit.
import Link from "next/link";
import { useState } from "react";
import { X } from "lucide-react";

export const START_COOKIE = "spotter_start_hidden";

export function StartChip({ done, total, next }: { done: number; total: number; next: { label: string; href: string } }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="start-chip" role="region" aria-label="Getting started">
      <span className="start-chip-count num">
        {done} of {total} done
      </span>
      <span className="start-chip-next">
        Next: <Link href={next.href}>{next.label}</Link>
      </span>
      <button
        type="button"
        className="start-chip-hide"
        aria-label="Hide getting started"
        onClick={() => {
          document.cookie = `${START_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
          setHidden(true);
          // The button is gone, so keyboard focus moves to the page heading instead of the top of the page.
          const h = document.querySelector<HTMLElement>(".page-main h1");
          if (h) {
            h.tabIndex = -1;
            h.focus();
          }
        }}
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
