import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { isSignedIn } from "@/server/page-session";
import { health } from "@/server/health-route";
import type { HealthReport } from "@/server/health";
import { StatusBoard } from "./StatusBoard";

export const metadata = { title: "Status | Spotter", description: "Is each part of Spotter working right now, in plain words." };
export const dynamic = "force-dynamic";

export default async function Status() {
  const signedIn = await isSignedIn();
  // The same cached answer /api/health gives, read directly (no rate limit for the page's own first paint).
  let report: HealthReport | null = null;
  try {
    report = await health.get();
  } catch (e) {
    console.error(`[spotter] status page: the health check failed (${e instanceof Error ? e.name : typeof e})`);
  }
  return (
    <>
      <PublicHeader band signedIn={signedIn} />
      <main className="shell legal">
        <h1 className="page-title">Status</h1>
        <p className="lede">Is each part of Spotter working right now? One line each, checked at most once a minute. Sandbox only, so no real money is ever at risk here.</p>
        <StatusBoard initial={report} />
      </main>
      <PublicFooter band />
    </>
  );
}
