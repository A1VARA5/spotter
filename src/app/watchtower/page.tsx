import { AppShell } from "@/ui/AppShell";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { loadWatchtower } from "@/watchtower/load";
import { loadBoard, markIncidentsSeen } from "@/watchtower/store";
import { withIncidents } from "@/watchtower/incidents";
import { INITIAL } from "@/watchtower/initial";
import { Watchtower } from "./Watchtower";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchtower | Spotter" };

export default async function WatchtowerPage() {
  const { db } = await getDeps();
  const { household } = await requirePageSession(db);
  const now = new Date();
  const board = await loadWatchtower(db, household, now);

  // The family's saved board, or the starting one, plus a page for anything that needs them right now.
  const saved = await loadBoard(db, household.id);
  const base = saved?.state && Array.isArray((saved.state as { pages?: unknown }).pages) ? saved.state : INITIAL;
  const { state, added } = withIncidents(base as typeof INITIAL, board.sources.payments, now, saved?.seen ?? []);
  if (added.length) {
    try {
      await markIncidentsSeen(db, household.id, state, added);
    } catch (e) {
      // The page still shows; the incident may just come back on the next visit.
      console.error(`[spotter] couldn't save incident pages for ${household.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return (
    <AppShell db={db} household={household} current="watchtower" wide>
      <div className="wt-head">
        <h1 className="page-title">Watchtower</h1>
        <p className="lede">
          Every payment, hold and scam sign on one board. Ask the assistant a question and it builds the chart.
        </p>
        {household.demo && (
          <p className="wt-banner">
            Demo family: this board includes a sample month, marked Sample. Anything you try on Try a payment shows up here too.
          </p>
        )}
      </div>
      <Watchtower board={JSON.parse(JSON.stringify(board))} initialState={state} since={now.toISOString()} />
    </AppShell>
  );
}
