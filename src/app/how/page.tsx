import Link from "next/link";
import { Check, X } from "lucide-react";
import { BrandMark, HoldTrack } from "@/ui/components";
import { ChannelGuide } from "./ChannelGuide";
import { FAQ } from "./faq";

export const metadata = {
  title: "How it works | Spotter",
  description: "Who does what, how each person connects, what happens to the money, and what Spotter can and can't do.",
};



export default function HowPage() {
  return (
    <main className="how">
      <section className="how-hero">
        <div className="shell">
          <header className="lnav">
            <Link href="/" className="brand brand-light" aria-label="Spotter home">
              <BrandMark />
              Spotter
            </Link>
            <nav className="lnav-links" aria-label="Main">
              <Link href="/">Home</Link>
              <a href="#faq">FAQ</a>
              <a href="/api/auth/paypal/start" className="lnav-login">
                Log in
              </a>
            </nav>
          </header>
          <h1 className="how-h1">How Spotter works</h1>
          <p className="how-lede">One person looks out for the others. Nobody else needs an account, and nobody installs anything new.</p>

          <div className="roles">
            <div className="role">
              <p className="role-who">You, the spotter</p>
              <p>Sign in with PayPal. Add the people you look out for, set their limits, and get asked when something needs you.</p>
            </div>
            <div className="role">
              <p className="role-who">Your people</p>
              <p>Gran, Leo and your AI agent. No accounts. Each connects once, then sends Spotter anything that asks for money.</p>
            </div>
            <div className="role">
              <p className="role-who">PayPal</p>
              <p>Holds the money while Spotter checks and you decide. Then pays it, or releases it.</p>
            </div>
          </div>
          <div className="how-track">
            <HoldTrack state="held" from="Gran" to="jamie.k1994@gmail.com" amount={25000} currency="GBP" />
          </div>
        </div>
      </section>

      <section className="shell how-sec" aria-labelledby="setup-title">
        <h2 id="setup-title" className="sec-title">
          Set up in three steps
        </h2>
        <ol className="setup3">
          <li>
            <span className="setup3-n num">1</span>
            <h3>Log in with PayPal</h3>
            <p>That&apos;s your account. Choose a PIN; you&apos;ll type it to approve anything.</p>
          </li>
          <li>
            <span className="setup3-n num">2</span>
            <h3>Add your people</h3>
            <p>Gran, a kid, an AI agent. Pick a preset, then tweak the weekly limit and the amount above which you&apos;re asked.</p>
          </li>
          <li>
            <span className="setup3-n num">3</span>
            <h3>Connect each one</h3>
            <p>Send Gran a Telegram link, give Leo the Discord app, paste your agent&apos;s key. About thirty seconds each.</p>
          </li>
        </ol>
      </section>

      <section className="how-band" aria-labelledby="channels-title">
        <div className="shell">
          <h2 id="channels-title" className="sec-title">
            How each person reaches Spotter
          </h2>
          <p className="sec-lede">The one time connect, then the everyday habit. Pick a channel.</p>
          <ChannelGuide />
        </div>
      </section>

      <section className="shell how-sec" aria-labelledby="limits-title">
        <h2 id="limits-title" className="sec-title">
          What Spotter can and can&apos;t do
        </h2>
        <div className="canc">
          <div className="canc-col">
            <h3>It can</h3>
            <ul>
              {[
                "Check anything sent to it: a forwarded email, a screenshot, a Telegram or Discord message, an agent's request.",
                "Hold a payment at PayPal while you decide, then pay or release it.",
                "Show you why, quoting the exact words that worried it.",
                "Stop gift card, crypto and Friends and Family payments outright.",
                "Make AI agents pay only through it, with no way to approve themselves.",
              ].map((t) => (
                <li key={t}>
                  <Check size={17} strokeWidth={2.4} aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="canc-col canc-not">
            <h3>It can&apos;t</h3>
            <ul>
              {[
                "Read texts, WhatsApp or calls by itself. Phones don't allow it, and that's a good thing.",
                "Stop someone paying directly in the PayPal app if they skip Spotter.",
                "Be right every time. When it isn't sure, it asks you instead of guessing.",
                "Move real money in this demo: it runs on the PayPal sandbox.",
              ].map((t) => (
                <li key={t}>
                  <X size={17} strokeWidth={2.4} aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="faq" className="shell how-sec" aria-labelledby="faq-title">
        <h2 id="faq-title" className="sec-title">
          Questions people ask
        </h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq-item">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="final">
        <div className="shell final-inner">
          <h2 className="final-title">See it with the demo family.</h2>
          <p className="final-lede">Gran, Leo and a shopping agent, already set up. No sign up, fake money.</p>
          <div className="start">
            <form action="/api/demo/start" method="post">
              <button className="btn btn-hold">Try the demo family</button>
            </form>
            <a className="btn btn-ghost" href="/api/auth/paypal/start">
              Log in with PayPal
            </a>
          </div>
        </div>
      </section>

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
