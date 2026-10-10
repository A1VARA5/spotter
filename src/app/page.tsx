import Link from "next/link";
import { BrandMark } from "@/ui/components";
import { PathBar } from "./landing/PathBar";
import { HeroScenes } from "./landing/HeroScenes";
import { MoneyPaths } from "./landing/MoneyPaths";
import { ScrollStory } from "./landing/ScrollStory";
import { Inspector } from "./landing/Inspector";
import { LitText } from "./landing/LitText";
import { Final, Hub } from "./landing/Sections";
import { FAQ } from "./how/faq";
import { LoopPauser } from "@/ui/LoopPauser";
import { getDb } from "@/db";
import { pageSession } from "@/server/page-session";
import "./landing/hero.css";
import "./landing/motion.css";

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
      <form action="/api/demo/start" method="post">
        <button className="btn btn-hold">Try the demo family</button>
      </form>
      <a className={onDark ? "btn btn-ghost" : "btn btn-quiet"} href="/api/auth/paypal/start">
        Log in with PayPal
      </a>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await pageSession(await getDb()).catch(() => null);
  const who: Who = session ? { name: session.household.spotter_name, demo: session.household.demo } : null;
  return (
    <main>
      <LoopPauser />
      <section className="hero-dark mpaths-host" data-loop>
        <MoneyPaths />
        <div className="shell">
          <header className="lnav">
            <Link href="/" className="brand brand-light" aria-label="Spotter home">
              <BrandMark />
              Spotter
            </Link>
            <nav className="lnav-links" aria-label="Main">
              <a href="/how">How it works</a>
              <a href="/how#faq">FAQ</a>
              {who ? (
                <Link href="/dashboard" className="lnav-login">
                  Dashboard
                </Link>
              ) : (
                <a href="/api/auth/paypal/start" className="lnav-login">
                  Log in
                </a>
              )}
            </nav>
          </header>

          <div className="hero-grid">
            <div className="hero-copy">
              <h1 className="hero-h1">A second look before the money goes.</h1>
              <p className="hero-p">
                Spotter sits between PayPal and the people you look out for: your gran, your kid, your AI shopping agent. When a
                payment looks wrong, PayPal holds the money and you get asked.
              </p>
              <StartButtons onDark who={who} />
              {!who && (
                <p className="hero-fine">No sign up for the demo: a family with Gran, Leo and a shopping agent, ready in ten seconds. Runs on the PayPal sandbox.</p>
              )}
            </div>

            <HeroScenes />
          </div>
        </div>
      </section>

      <PathBar />

      <ScrollStory />

      <section className="shell statement">
        <LitText
          lead="Scams don't break in, they ask nicely."
          rest="A text from a new number, a parcel fee, a shop page that whispers to your AI. Spotter can't stop the asking. It makes sure someone you trust gets one look before the money leaves."
        />
      </section>

      <section id="moments" className="shell moments2" aria-labelledby="moments-title">
        <h2 id="moments-title" className="sec-title reveal">
          It reads what they read
        </h2>
        <p className="sec-lede reveal">Wherever the ask turns up, Spotter checks the real thing, marks the words that worried it, and stops the money before it moves.</p>
        <Inspector />
      </section>

      <Hub />

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
      </section>
      <Final>
        <StartButtons onDark who={who} />
      </Final>

      <footer className="shell footer">
        <p>Built for the PayPal AI Hackathon. Sandbox only.</p>
        <p>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </p>
      </footer>
    </main>
  );
}
