import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { HeroScenes } from "./landing/HeroScenes";
import { NetworkField } from "./landing/NetworkField";
import { Problem } from "./landing/Problem";
import { Walkthrough } from "./landing/Walkthrough";
import { AgentToolkit } from "./landing/AgentToolkit";
import { WatchtowerPeek } from "./landing/WatchtowerPeek";
import { Final } from "./landing/Sections";
import { FAQ } from "./how/faq";
import { LoopPauser } from "@/ui/LoopPauser";
import { DemoStart } from "@/ui/DemoStart";
import { getDb } from "@/db";
import { listSpenders } from "@/core/households";
import { pageSession } from "@/server/page-session";
import "./landing/hero.css";
import "./landing/motion.css";
import "./landing/story.css";
import "./landing/scenes.css";
import "./landing/moments.css";

type Who = { name: string; demo: boolean; agentId: string | null } | null;

/** Signed in: one way back in. Signed out: the demo first, then PayPal. */
function StartButtons({ onDark = false, who, label = "Try the demo family" }: { onDark?: boolean; who: Who; label?: string }) {
  if (who)
    return (
      <div className="start">
        <Link className="btn btn-hold" href="/dashboard">
          {who.demo ? "Back to your demo family" : `Open your dashboard, ${who.name}`}
        </Link>
        <Link className={onDark ? "btn btn-ghost" : "btn btn-quiet"} href="/how">
          How Spotter works
        </Link>
      </div>
    );
  return (
    <div className="start">
      <DemoStart label={label} />
      <a className={onDark ? "btn btn-ghost" : "btn btn-quiet"} href="/api/auth/paypal/start">
        Log in with PayPal
      </a>
    </div>
  );
}

/** The one next step at the end of a section: into the demo, or back to it. */
function DemoButton({ who, label = "Try the demo family" }: { who: Who; label?: string }) {
  if (who)
    return (
      <Link className="btn btn-hold" href="/dashboard">
        {who.demo ? "Back to your demo family" : "Open your dashboard"}
      </Link>
    );
  return <DemoStart label={label} />;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await getDb().catch(() => null);
  const session = db ? await pageSession(db).catch(() => null) : null;
  const agent = session && db ? (await listSpenders(db, session.household.id).catch(() => [])).find((s) => s.kind === "agent") : undefined;
  const who: Who = session ? { name: session.household.spotter_name, demo: session.household.demo, agentId: agent?.id ?? null } : null;
  const connectHref = who?.agentId ? `/people/${who.agentId}` : "/how#channels";

  return (
    <main>
      <LoopPauser />
      <section className="hero-dark net-host" data-loop>
        <NetworkField focus=".hs" avoid=".lap, .hs-phone, .hs-controls, .hs-caption, .hs-chan, .lnav" calm=".hero-copy" />
        <div className="shell">
          <PublicHeader signedIn={!!who} current="home" />

          <div className="hero-grid">
            <div className="hero-copy">
              {/* Leads with what only Spotter does (asking the person the text pretends to be); the PayPal hold is how. */}
              <h1 className="hero-h1">Banks ask the person paying. Spotter asks the person the text pretends to be.</h1>
              <p className="hero-p">
                A text says it&apos;s Tom and asks Gran for &pound;250. PayPal holds it, Spotter asks the real Tom, and his Not me releases it.
                It also catches a shop page that shows phones a card form and security scanners nothing, and an AI agent reaching for a PayPal tool its job
                never needs.
              </p>
              <StartButtons onDark who={who} label="Try it on fake money" />
              {!who && (
                <p className="hero-fine">
                  No sign up. You get a family with Gran, Leo and a shopping agent on the PayPal sandbox, with one payment already waiting for you, so
                  nothing real is spent.
                </p>
              )}
            </div>

            <HeroScenes />
          </div>
        </div>
      </section>

      <Problem />

      <Walkthrough cta={<DemoButton who={who} label="Try it on the demo family" />} />

      <AgentToolkit
        connectHref={connectHref}
        cta={
          <a className="next-link" href="/how#limits">
            What Spotter can and can&apos;t do
          </a>
        }
      />

      <WatchtowerPeek
        cta={
          who ? (
            <Link className="btn btn-quiet" href="/watchtower">
              Open Watchtower
            </Link>
          ) : (
            <DemoButton who={who} label="Try the demo family, Watchtower included" />
          )
        }
      />

      <section className="shell how-sec land-faq" aria-labelledby="faq-title">
        <h2 id="faq-title" className="sec-title reveal">
          Questions people ask
        </h2>
        <div className="faq">
          {FAQ.slice(0, 5).map(([q, a]) => (
            <details key={q} className="faq-item">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
        <p className="land-faq-more">
          <a href="/how">How Spotter works, step by step, with every channel</a>
        </p>
        <p className="land-biz">
          Runs a business? The same Spotter holds a supplier invoice whose bank details suddenly changed, and an AI agent
          that orders over budget.{" "}
          <a href={who ? "/setup?step=name" : "/api/auth/paypal/start"}>{who ? "Set up Spotter for a business" : "Log in with PayPal to set up a business"}</a>
        </p>
      </section>
      <Final footer={<PublicFooter />}>
        <StartButtons onDark who={who} label="Try it on fake money" />
      </Final>
    </main>
  );
}
