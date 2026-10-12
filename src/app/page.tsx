import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { HeroScenes } from "./landing/HeroScenes";
import { NetworkField } from "./landing/NetworkField";
import { Problem } from "./landing/Problem";
import { Walkthrough } from "./landing/Walkthrough";
import { WatchtowerPeek } from "./landing/WatchtowerPeek";
import { Final } from "./landing/Sections";
import { FAQ } from "./how/faq";
import { LoopPauser } from "@/ui/LoopPauser";
import { DemoStart } from "@/ui/DemoStart";
import { getDb } from "@/db";
import { pageSession } from "@/server/page-session";
import "./landing/hero.css";
import "./landing/motion.css";
import "./landing/story.css";
import "./landing/scenes.css";
import "./landing/moments.css";

type Who = { name: string; demo: boolean } | null;

/** Signed in: one way back in. Signed out: the demo first, then PayPal. */
function StartButtons({ onDark = false, who }: { onDark?: boolean; who: Who }) {
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
      <DemoStart />
      <a className={onDark ? "btn btn-ghost" : "btn btn-quiet"} href="/api/auth/paypal/start">
        Log in with PayPal
      </a>
    </div>
  );
}

/** The one next step at the end of a section: into the demo, or back to it. */
function DemoButton({ who }: { who: Who }) {
  if (who)
    return (
      <Link className="btn btn-hold" href="/dashboard">
        {who.demo ? "Back to your demo family" : "Open your dashboard"}
      </Link>
    );
  return <DemoStart />;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await getDb().catch(() => null);
  const session = db ? await pageSession(db).catch(() => null) : null;
  const who: Who = session ? { name: session.household.spotter_name, demo: session.household.demo } : null;

  return (
    <main>
      <LoopPauser />
      <section className="hero-dark net-host" data-loop>
        <NetworkField focus=".hs" avoid=".lap, .hs-phone, .hs-controls, .hs-caption, .hs-chan, .lnav" calm=".hero-copy" />
        <div className="shell">
          <PublicHeader signedIn={!!who} current="home" />

          <div className="hero-grid" id="hero" tabIndex={-1}>
            <div className="hero-copy">
              {/* Leads with what only Spotter does (asking the person the text pretends to be); the PayPal hold is how. */}
              <h1 className="hero-h1">Banks ask the person paying. Spotter asks the person the text pretends to be.</h1>
              <p className="hero-p">
                A text says it&apos;s Tom and asks Gran for &pound;250. PayPal holds it, Spotter asks the real Tom, and when he taps Not me, PayPal cancels
                the hold and Gran keeps her &pound;250.
              </p>
              <StartButtons onDark who={who} />
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

      <Walkthrough cta={<DemoButton who={who} />} />

      <WatchtowerPeek
        cta={
          who ? (
            <Link className="btn btn-quiet" href="/watchtower">
              Open Watchtower
            </Link>
          ) : (
            <DemoButton who={who} />
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
        <StartButtons onDark who={who} />
      </Final>
    </main>
  );
}
