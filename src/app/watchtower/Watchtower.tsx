"use client";
// Loads AG Studio (about 1.5 MB) in the browser only, on this page only.
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { CaseNote } from "./Studio";
import type { Sources, WatchAlert } from "@/watchtower/data";

const Studio = dynamic(() => import("./Studio"), { ssr: false, loading: () => <div className="wt-loading">Opening Watchtower</div> });

type Wire = { payments: Array<Omit<Sources["payments"][number], "when"> & { when: string }>; signs: Array<Omit<Sources["signs"][number], "when"> & { when: string }>; people: Sources["people"] };

export function Watchtower({ sources, alerts, notes, sampleIds }: { sources: Wire; alerts: WatchAlert[]; notes: CaseNote[]; sampleIds: string[] }) {
  // Dates arrive as text from the server; Studio wants real Date objects.
  const live = useMemo<Sources>(
    () => ({
      payments: sources.payments.map((r) => ({ ...r, when: new Date(r.when) })),
      signs: sources.signs.map((r) => ({ ...r, when: new Date(r.when) })),
      people: sources.people,
    }),
    [sources],
  );
  return (
    <div className="wt-frame">
      <Studio sources={live} alerts={alerts} notes={notes} sampleIds={sampleIds} />
    </div>
  );
}
