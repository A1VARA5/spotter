// The signed in app frame: a sidebar with the household, navigation with live counts and the people, like a
// real product app. On phones the sidebar becomes a bottom tab bar.
import Link from "next/link";
import { Activity, FlaskConical, Inbox, Plus, UserRound } from "lucide-react";
import type { Db } from "@/db";
import type { Household } from "@/core/households";
import { listSpenders } from "@/core/households";
import { BrandMark } from "./components";

export type Section = "waiting" | "activity" | "try" | "account" | `person:${string}`;

const KIND: Record<string, string> = { person: "Relative", kid: "Kid", agent: "AI agent" };

export async function AppShell({ db, household, current, wide = false, children }: { db: Db; household: Household; current: Section; wide?: boolean; children: React.ReactNode }) {
  const people = await listSpenders(db, household.id);
  const [w] = await db.query<{ n: string }>(
    "select count(*)::text as n from payments p join spenders s on s.id = p.spender_id where s.household_id = $1 and p.status = 'needs_approval'",
    [household.id],
  );
  const waiting = Number(w?.n ?? 0);
  const nav = [
    { key: "waiting", href: "/dashboard", label: "Waiting for you", icon: Inbox, count: waiting },
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
            <Link key={n.key} href={n.href} className="side-link" aria-current={current === n.key ? "page" : undefined}>
              <n.icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{n.label}</span>
              {"count" in n && n.count > 0 && <span className="side-count num">{n.count}</span>}
            </Link>
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
              <span className="side-person-kind">{KIND[p.kind] ?? p.kind}</span>
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
        <form className="side-foot" action="/api/auth/logout" method="post">
          <button className="side-signout">Sign out</button>
        </form>
      </aside>
      <main className="app-main" data-wide={wide || undefined}>
        {children}
      </main>
      <nav className="tabbar" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.key} href={n.href} className="tab" aria-current={current === n.key ? "page" : undefined}>
            <n.icon size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>{n.label.replace("Waiting for you", "Waiting").replace("Try a payment", "Try")}</span>
            {"count" in n && n.count > 0 && <span className="tab-count num">{n.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
