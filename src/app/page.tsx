import Link from "next/link";
import { BrandMark } from "@/ui/components";
import { GranPhone, SpotterPhone } from "./landing/Devices";
import { HeroStage } from "./landing/HeroStage";
import { ScrollStory } from "./landing/ScrollStory";
import { Inspector } from "./landing/Inspector";
import { LitText } from "./landing/LitText";
import { Final, Hub } from "./landing/Sections";

function StartButtons({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className="start">
      <a className="btn btn-hold" href="/api/auth/paypal/start">
        Log in with PayPal
      </a>
      <form action="/api/demo/start" method="post">
        <button className={onDark ? "btn btn-ghost" : "btn btn-quiet"}>Try the demo family</button>
      </form>
    </div>
  );
}

const GRAN_TEXT = "Hi Mum it's me, dropped my phone in the bath so this is my new number. Can you send £250 to my mate's PayPal, Friends and Family so there's no fee. Please hurry it's urgent x";

export default function Home() {
  return (
    <main>
      <section className="hero-dark">
        <div className="shell">
          <header className="lnav">
            <Link href="/" className="brand brand-light" aria-label="Spotter home">
              <BrandMark />
              Spotter
            </Link>
            <nav className="lnav-links" aria-label="Main">
              <a href="#moments">How it helps</a>
              <a href="#story-title">How it works</a>
              <a href="/api/auth/paypal/start" className="lnav-login">
                Log in
              </a>
            </nav>
          </header>

          <div className="hero-grid">
            <div className="hero-copy">
              <h1 className="hero-h1">A second look before the money goes.</h1>
              <p className="hero-p">
                Spotter sits between PayPal and the people you look out for: your gran, your kid, your AI shopping agent. When a
                payment looks wrong, PayPal holds the money and you get asked.
              </p>
              <StartButtons onDark />
              <p className="hero-fine">Runs on the PayPal sandbox. Nothing real is paid.</p>
            </div>

            <HeroStage label="Gran gets a scam text asking for £250. Spotter holds the payment at PayPal and asks you.">
              <GranPhone text={GRAN_TEXT} scale={0.68} />

              <SpotterPhone scale={0.68} />
            </HeroStage>
          </div>
        </div>
      </section>

      <section className="runs" aria-label="What Spotter runs on">
        <div className="shell runs-inner reveal-kids">
          <span className="runs-label">Runs on</span>
          <span>PayPal</span>
          <span>Claude</span>
          <span>Channel3</span>
          <span>Agentboxd</span>
          <span>AG Grid</span>
        </div>
      </section>

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
      <Final>
        <StartButtons onDark />
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
