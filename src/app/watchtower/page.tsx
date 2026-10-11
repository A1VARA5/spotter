import { AppShell } from "@/ui/AppShell";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { loadWatchtower } from "@/watchtower/load";
import { loadBoard, markIncidentsSeen } from "@/watchtower/store";
import { withIncidents } from "@/watchtower/incidents";
import { startingBoard } from "@/watchtower/initial";
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
  const usable = !saved || Array.isArray((saved.state as { pages?: unknown } | null)?.pages);
  if (!usable) console.error(`[spotter] saved Watchtower board for ${household.id} isn't a board; showing the starting board and leaving the saved one alone`);
  const start = startingBoard(household.kind);
  const base = saved && usable ? saved.state : start;
  // loadWatchtower reads at most 500 of the family's own payments; past that, a missing row isn't proof a payment is gone.
  const complete = board.sources.payments.filter((r) => r.sample === "No").length < 500;
  const { state, added, changed } = withIncidents(base as typeof start, board.sources.payments, now, saved?.seen ?? [], complete);
  // Saved when tabs opened or closed (closed ones are over or past the cap of three).
  if (changed && usable) {
    try {
      await markIncidentsSeen(db, household.id, state, added);
    } catch (e) {
      // The page still shows this visit's tabs; unsaved, new ones may open again and closed ones may come back next visit.
      console.error(`[spotter] couldn't save incident pages for ${household.id}:`, e);
    }
  }

  return (
    <AppShell db={db} household={household} current="watchtower" wide>
      <div className="wt-head">
        <h1 className="page-title">Watchtower</h1>
        <p className="lede">
          {household.kind === "business"
            ? "Every supplier payment, hold and invoice caught on one board. Ask the assistant a question and it builds the chart."
            : "Every payment, hold and scam sign on one board. Ask the assistant a question and it builds the chart."}
        </p>
        {household.demo && (
          <p className="wt-banner">
            Demo family: this board includes a sample month, marked Sample. Anything you try on Try a payment shows up here too.
          </p>
        )}
      </div>
      <Watchtower board={JSON.parse(JSON.stringify(board))} initialState={state} since={now.toISOString()} kind={household.kind} spotterName={household.spotter_name} />
    </AppShell>
  );
}
