// The signed in app frame: a sidebar with the household, navigation with live counts and the people, like a
// real product app. On phones the sidebar becomes a bottom tab bar.
//
// One layout system for every signed in page, picked with the `layout` prop (pages never set their own width):
// - "rail" (default): a fluid primary column (up to 760 px, up to 1160 px from 1600 px wide) and, from 1280 px, a sticky
//   context rail of 320 to 400 px beside it. Below 1280 px the rail drops under the primary column.
// - "wide": the full width of the main area, for grids and boards (Activity, Watchtower).
// - "narrow": one centred column of 720 px, for settings and reading (Account, privacy, terms).
// Everything sits centred inside a 1600 px box, so no page hugs the sidebar with empty space beside it.
//
// Case files: from 1600 px the primary column grows to 1160 px so an open held card is wide enough for the case
// file's own two column container query (.cf-body in src/ui/casefile.css), and the panel that opens from
// Everything today is 1060 px wide for the same reason.
import { Fragment } from "react";
import Link from "next/link";
import { Activity, Binoculars, FlaskConical, Inbox, Plus, UserRound } from "lucide-react";
import type { Db } from "@/db";
import type { Household } from "@/core/households";
import { listSpenders } from "@/core/households";
import { BrandMark } from "./components";
import { SignOut } from "./SignOut";
import { labelsFor } from "@/ui/labels";

export type Section = "waiting" | "watchtower" | "checks" | "activity" | "try" | "account" | `person:${string}`;
export type Layout = "rail" | "wide" | "narrow";

export async function AppShell({
  db,
  household,
  current,
  layout = "rail",
  rail,
  railLabel = "More on this page",
  children,
}: {
  db: Db;
  household: Household;
  current: Section;
  layout?: Layout;
  /** The context rail (layout "rail" only): beside the primary column from 1280 px, under it below that. */
  rail?: React.ReactNode;
  railLabel?: string;
  children: React.ReactNode;
}) {
  const people = await listSpenders(db, household.id);
  const [w] = await db.query<{ n: string }>(
    "select count(*)::text as n from payments p join spenders s on s.id = p.spender_id where s.household_id = $1 and p.status = 'needs_approval'",
    [household.id],
  );
  const waiting = Number(w?.n ?? 0);
  const nav = [
    { key: "waiting", href: "/dashboard", label: "Waiting for you", icon: Inbox, count: waiting },
    { key: "watchtower", href: "/watchtower", label: "Watchtower", icon: Binoculars },
    { key: "activity", href: "/ledger", label: "Activity", icon: Activity },
    { key: "try", href: "/demo", label: "Try a payment", icon: FlaskConical },
    { key: "account", href: "/account", label: "Account", icon: UserRound },
  ] as const;

  return (
    <div className="app">
      <aside className="side" aria-label="Spotter">
        <Link href="/" className="side-brand" aria-label="Spotter home">
          <BrandMark />
          <span>Spotter</span>
        </Link>
        <div className="side-house">
          <span className="side-house-name">{household.spotter_name}</span>
          <span className="side-house-sub">{household.demo ? "Demo family, sandbox" : "PayPal sandbox"}</span>
        </div>
        <nav className="side-nav" aria-label="Main">
          {nav.map((n) => (
            <Fragment key={n.key}>
              <Link href={n.href} className="side-link" aria-current={current === n.key ? "page" : undefined}>
                <n.icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{n.label}</span>
                {"count" in n && n.count > 0 && <span className="side-count num">{n.count}</span>}
              </Link>
              {n.key === "watchtower" && (
                <Link href="/checks" className="side-sublink" aria-current={current === "checks" ? "page" : undefined}>
                  How Spotter checked it
                </Link>
              )}
            </Fragment>
          ))}
        </nav>
        <div className="side-people">
          <p className="side-heading">People</p>
          {people.map((p) => (
            <Link key={p.id} href={`/people/${p.id}`} className="side-person" aria-current={current === `person:${p.id}` ? "page" : undefined}>
              <span className="side-avatar" data-kind={p.kind} aria-hidden="true">
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="side-person-name">{p.name}</span>
              <span className="side-person-kind">{labelsFor(household.kind).kind[p.kind] ?? p.kind}</span>
            </Link>
          ))}
          <Link href="/setup?step=people" className="side-person side-add">
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            <span>Add someone</span>
          </Link>
        </div>
        <Link href="/how" className="side-help">
          How Spotter works
        </Link>
        <div className="side-foot">
          <SignOut demo={household.demo} className="side-signout" />
        </div>
      </aside>
      <main className="app-main">
        <div className="page-frame" data-layout={layout} data-rail={(layout === "rail" && rail != null) || undefined}>
          <div className="page-main">{children}</div>
          {layout === "rail" && rail != null && (
            <aside className="page-rail" aria-label={railLabel}>
              {rail}
            </aside>
          )}
        </div>
      </main>
      <nav className="tabbar" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.key} href={n.href} className="tab" aria-current={current === n.key ? "page" : undefined}>
            <n.icon size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>{n.label.replace("Waiting for you", "Waiting").replace("Try a payment", "Try").replace("Watchtower", "Watch")}</span>
            {"count" in n && n.count > 0 && <span className="tab-count num">{n.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
