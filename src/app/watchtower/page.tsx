import { AppShell } from "@/ui/AppShell";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";
import { listPayments } from "@/core/lifecycle";
import { SIGN_LABEL, toSources, watchAlerts } from "@/watchtower/data";
import { sampleMonth } from "@/watchtower/sample";
import { Watchtower } from "./Watchtower";
import type { CaseNote } from "./Studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchtower | Spotter" };

export default async function WatchtowerPage() {
  const { db } = await getDeps();
  const { household } = await requirePageSession(db);
  const spenders = await listSpenders(db, household.id);
  const real = await listPayments(db, household.id, 500);
  // Demo families get a labelled sample month so there's something to explore. Real families never do.
  const sample = household.demo ? sampleMonth(spenders) : [];
  const payments = [...real, ...sample];
  const sources = toSources(payments, spenders);
  const notes: CaseNote[] = payments.map((p) => ({
    id: p.id,
    reasons: p.decision?.reasons ?? [],
    signs: (p.decision?.flags ?? p.ai?.flags ?? []).map((f) => ({ sign: SIGN_LABEL[f.kind], severity: f.severity, why: f.why })),
    ...(p.case_file ? { caseHeadline: p.case_file.headline, caseFindings: p.case_file.findings.map((f) => f.text) } : {}),
  }));

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
      <Watchtower sources={JSON.parse(JSON.stringify(sources))} alerts={watchAlerts(sources.payments)} notes={notes} sampleIds={sample.map((p) => p.id)} />
    </AppShell>
  );
}
