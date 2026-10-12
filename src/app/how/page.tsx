import Link from "next/link";
import { Check, FileCheck, Link2, ShoppingBag, Users, X } from "lucide-react";
import { HoldTrack } from "@/ui/components";
import { ChannelGuide } from "./ChannelGuide";
import { FAQ } from "./faq";
import { NetworkField } from "@/app/landing/NetworkField";
import { getDb } from "@/db";
import { pageSession } from "@/server/page-session";
import { NewDemo } from "./NewDemo";
import { DemoStart } from "@/ui/DemoStart";
import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { AgentToolkit } from "@/app/landing/AgentToolkit";
import { listSpenders } from "@/core/households";
import "@/app/landing/motion.css";
import "@/app/landing/agent.css";
import "./how.css";

export const metadata = {
  title: "How it works | Spotter",
  description: "Who does what, how each person connects, what happens to the money, and what Spotter can and can't do.",
};

const WAITS = [
  {
    icon: Users,
    title: "Who's being paid",
    text: "Has anyone in the family paid them before? Then the Spotter network: did other Spotter families say no to this payee in the last 30 days? Families only ever share a scrambled fingerprint of the payee, never names or messages.",
  },
  {
    icon: Link2,
    title: "Where the links really go",
    text: "Every link in the message gets followed to where it ends up, with its domain age, look alike names and borrowed brands. A parcel fee link that points at a site made four days ago says so.",
  },
  {
    icon: ShoppingBag,
    title: "A safer way to buy it",
    text: "If it's a real product, Spotter prices it at real shops with Channel3, and says when it's far too dear or far too cheap. One tap denies the risky payment and buys it at a real shop instead, through PayPal, with buyer protection.",
  },
  {
    icon: FileCheck,
    title: "Every line has a source",
    text: "Each finding in the case file names the check it came from. If the AI writes something no check found, code throws it out. The case agent can only read: it can't pay, approve or deny.",
  },
] as const;

// The page reads the session so someone signed in sees their way back, not "Log in".
export const dynamic = "force-dynamic";

export default async function HowPage() {
  const db = await getDb().catch(() => null);
  const session = db ? await pageSession(db).catch(() => null) : null;
  const who = session ? { name: session.household.spotter_name, demo: session.household.demo } : null;
  const agent = session && db ? (await listSpenders(db, session.household.id).catch(() => [])).find((s) => s.kind === "agent") : undefined;
  const connectHref = agent ? `/people/${agent.id}` : "#channels";
  return (
    <main className="how">
      <section className="how-hero net-host">
        <NetworkField quiet runFor={5} fx={0.84} fy={0.22} calm=".how-h1, .how-lede" avoid=".role, .how-track, .lnav" />
        <div className="shell">
          <PublicHeader signedIn={!!who} current="how" />
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
              <p>Holds the money while Spotter checks and you decide. Then pays it, or cancels the hold.</p>
            </div>
          </div>
          <div className="how-track">
            <HoldTrack state="held" from="Gran" to="jamie.k1994@mail.example" amount={25000} currency="GBP" />
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

      <section id="channels" className="how-band" aria-labelledby="channels-title">
        <div className="shell">
          <h2 id="channels-title" className="sec-title">
            How each person reaches Spotter
          </h2>
          <p className="sec-lede">The one time connect, then the everyday habit. Pick a channel.</p>
          <ChannelGuide />
        </div>
      </section>

      <AgentToolkit
        connectHref={connectHref}
        cta={
          <a className="next-link" href="#limits">
            What Spotter can and can&apos;t do
          </a>
        }
      />

      <section className="shell how-sec" aria-labelledby="waits-title">
        <div className="waits">
          <div>
            <h2 id="waits-title" className="sec-title">
              While the money waits
            </h2>
            <p className="sec-lede">A held payment isn&apos;t just parked. Spotter&apos;s case agent looks into it, usually before you&apos;ve opened the alert.</p>
            <p className="waits-kernel">
              When a message has a link that wants card details or a login, I don&apos;t want Gran clicking it to find out. So the case agent opens that one link in a
              throwaway cloud browser (KERNEL), notes where it really ends up and what the page asks for, takes a small screenshot, and the browser gets deleted. It
              only looks. It never types, clicks or submits anything.
            </p>
            <p className="waits-kernel">
              The same KERNEL browser checks a shop an AI agent is about to pay: what a person sees next to what the agent reads (hidden instructions), and the tools
              the page offers AI agents. For a parcel style link it opens the page twice at once, as a desktop and as Gran&apos;s phone, because some scam pages only
              show the card form to phones.
            </p>
            {who && (
              <p className="waits-kernel">
                <Link href="/checks">How Spotter checked it</Link> shows each of these on your own family&apos;s payments.
              </p>
            )}
          </div>
          <ul className="waits-list">
            {WAITS.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="how-wt">
          <h3>
            Watchtower, the family&apos;s board{" "}
            <span className="by-tag" translate="no">
              AG Studio
            </span>
          </h3>
          <p>
            Every payment, hold and scam sign in one place, and you can just ask it things. &quot;What did Leo try to spend on games?&quot; and Claude builds the chart
            for you. It can read and rearrange the board, nothing else, and it never sees the scam messages themselves.
          </p>
        </div>
      </section>

      <section id="limits" className="shell how-sec" aria-labelledby="limits-title">
        <h2 id="limits-title" className="sec-title">
          What Spotter can and can&apos;t do
        </h2>
        <div className="canc">
          <div className="canc-col">
            <h3>It can</h3>
            <ul>
              {[
                "Check anything sent to it: a forwarded email, a forwarded Telegram message, a Discord message (right click, Apps, Check with Spotter), an agent's request.",
                "Hold a payment at PayPal while you decide, then pay it or cancel the hold.",
                "Show you why, quoting the exact words that worried it.",
                "Refuse payments with no way back if it's a scam: gift cards, crypto and Friends and Family.",
                "Make AI agents pay only through it, with no way to approve themselves.",
                "Look into a held payment for you and offer a safer shop when there is one.",
                ["Read a screenshot of a message and check its words, or price each thing in a photo of an ad or a quote at real shops.", "Channel3"],
                ["Watch a price for you at real shops and tell you when it drops. It never buys on its own.", "Channel3"],
              ].map((item) => {
                const [t, by] = typeof item === "string" ? [item, null] : item;
                return (
                  <li key={t}>
                    <Check size={17} strokeWidth={2.4} aria-hidden="true" />
                    <span>
                      {t}
                      {by && (
                        <>
                          {" "}
                          <span className="by-tag" translate="no">
                            {by}
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="canc-col canc-not">
            <h3>It can&apos;t</h3>
            <ul>
              {[
                "Read texts, chats or calls by itself. Phones don't allow it, and that's a good thing.",
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
        <p className="canc-more">
          It only runs on the sandbox for now. <Link href="/real-money">What would need to be true before real money</Link>, and{" "}
          <Link href="/status">what&apos;s working right now</Link>.
        </p>
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

      <section className="final how-final">
        <div className="shell final-inner">
          {who ? (
            <>
              <h2 className="final-title">{who.demo ? "Try it on your demo family." : "Try it on your own family."}</h2>
              <p className="final-lede">Everything on this page works there now: try a payment, then approve or deny it.</p>
              <div className="start">
                <Link className="btn btn-hold" href="/dashboard">
                  {who.demo ? "Back to your demo family" : `Open your dashboard, ${who.name}`}
                </Link>
                <NewDemo demo={who.demo} />
              </div>
            </>
          ) : (
            <>
              <h2 className="final-title">See it with the demo family.</h2>
              <p className="final-lede">Gran, Leo and a shopping agent, already set up. No sign up, fake money.</p>
              <div className="start">
                <DemoStart />
                <a className="btn btn-ghost" href="/api/auth/paypal/start">
                  Log in with PayPal
                </a>
              </div>
            </>
          )}
        </div>
        <div className="shell">
          <PublicFooter />
        </div>
      </section>
    </main>
  );
}
