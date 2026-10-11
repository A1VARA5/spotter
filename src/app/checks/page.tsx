import Link from "next/link";
import { AppShell, type Section } from "@/ui/AppShell";
import { getDeps } from "@/server/deps";
import { requirePageSession } from "@/server/page-session";
import { listSpenders } from "@/core/households";
import { listPayments } from "@/core/lifecycle";
import { engines } from "./checks";
import "./checks.css";
import { ToolkitCoverage } from "@/ui/ToolkitCoverage";

export const dynamic = "force-dynamic";
export const metadata = { title: "How Spotter checked it | Spotter" };

export default async function ChecksPage() {
  const { db } = await getDeps();
  const { household } = await requirePageSession(db);
  const names = Object.fromEntries((await listSpenders(db, household.id)).map((s) => [s.id, s.name]));
  const payments = await listPayments(db, household.id, 500);
  const [lastEvent] = await db.query<{ type: string; paymentId: string }>(
    `select e.event_type as type, e.payment_id as "paymentId" from paypal_events e
       join payments p on p.id = e.payment_id join spenders s on s.id = p.spender_id
     where s.household_id = $1 order by e.received_at desc limit 1`,
    [household.id],
  );
  const list = engines(payments, names, { lastEvent: lastEvent ?? null, demo: household.demo });

  return (
    // "checks" has no main nav item of its own: the sidebar's small "How Spotter checked it" link points here.
    <AppShell db={db} household={household} current={"checks" as Section}>
      <h1 className="page-title">How Spotter checked it</h1>
      <p className="lede ck-lede">
        Each payment goes past the same engines. Here is what each one does, and the latest time it worked for your family.
        {household.demo ? " Cases marked Example were checked earlier; anything you send on Try a payment runs live." : ""}
      </p>
      <ol className="ck-list">
        {list.map((e) => (
          <li key={e.id} className="ck-row" aria-labelledby={`ck-${e.id}`}>
            <div className="ck-what">
              <h2 id={`ck-${e.id}`} className="ck-name">
                {e.name} <span className="ck-by">{e.by}</span>
              </h2>
              <p className="ck-does">{e.does}</p>
            </div>
            <div className="ck-live" data-empty={!e.example || undefined}>
              <p className="ck-live-label">{e.example ? "From your family" : "Not used yet"}</p>
              {e.example ? (
                <>
                  <p className="ck-live-text">
                    {e.example.example && <span className="ck-tag">Example</span>} {e.example.text}
                  </p>
                  {e.example.shows && e.example.shows.length > 0 && (
                    <ul className="ck-shows" aria-label="What it shows">
                      {e.example.shows.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                  <p className="ck-links">
                    <Link href={e.example.href}>{e.example.label}</Link>
                    {e.example.evidence && (
                      <a href={e.example.evidence} target="_blank" rel="noopener">
                        Evidence pack
                      </a>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <p className="ck-live-text">{e.empty.text}</p>
                  <p className="ck-links">
                    <Link href={e.empty.href}>{e.empty.label}</Link>
                  </p>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      <ToolkitCoverage />
      <p className="ck-foot">
        None of these can move money. Only you can approve a held payment, with your PIN. <Link href="/how">How Spotter works</Link>
      </p>
    </AppShell>
  );
}
