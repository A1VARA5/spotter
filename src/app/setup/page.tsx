import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";
import { PRESETS } from "@/core/presets";
import { BrandMark } from "@/ui/components";
import { Setup, type SetupStep } from "./Setup";
import { Preview } from "./Preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up | Spotter" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const db = await getDb();
  const { household, unlocked } = await requirePageSession(db);
  // Once there's a PIN, everything here changes settings, so it needs the unlock. The dashboard asks for it.
  if (household.pin_hash && !unlocked) redirect("/dashboard?unlock=setup");
  const people = (await listSpenders(db, household.id)).map(({ id, name, kind }) => ({ id, name, kind }));
  // Resume where they stopped; ?step lets Back revisit an earlier screen.
  const resume: SetupStep = !household.pin_hash ? "name" : people.length === 0 ? "people" : "connect";
  const asked = (await searchParams).step as SetupStep | undefined;
  const allowed: SetupStep[] = household.pin_hash ? ["name", "people", "connect"] : ["name", "pin"];
  const step = asked && allowed.includes(asked) ? asked : resume;
  return (
    <main className="setup-split">
      <div className="setup-shell">
      <a href="/" className="brand setup-brand" aria-label="Spotter home">
        <BrandMark />
        Spotter
      </a>
      <Setup
        step={step}
        spotterName={household.spotter_name}
        pinSet={Boolean(household.pin_hash)}
        people={people}
        presets={Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, hint: p.hint, weekly: p.allowance.weekly.amount, askAbove: p.allowance.askAbove.amount }))}
      />
      </div>
      <Preview step={step} spotterName={household.spotter_name} people={people} />
    </main>
  );
}
