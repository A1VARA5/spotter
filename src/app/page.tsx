import { TopBar } from "@/ui/components";
import { Stage } from "./Stage";

export default function Home() {
  return (
    <main className="shell">
      <TopBar current="home" />

      <section className="hero">
        <h1 className="hero-title">Every payment gets a spotter.</h1>
        <p className="hero-lede">
          Spotter holds a payment for a moment, checks it, and asks someone you trust when it matters. For your AI agent,
          your gran and your kid.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="/api/auth/paypal/start">
            Log in with PayPal
          </a>
          <form action="/api/demo/start" method="post">
            <button className="btn btn-quiet">Try the demo family</button>
          </form>
        </div>
      </section>

      <Stage />

      <div className="rows">
        <section className="row">
          <h2 className="row-title">For your AI agent</h2>
          <p className="row-body">
            Agents can buy things now, and shop pages can talk to them. Give yours an allowance: a weekly budget, things it
            should never buy, and a limit above which it has to ask you. A page that hides instructions for the agent gets
            stopped, and you see the exact hidden line.
          </p>
        </section>
        <section className="row">
          <h2 className="row-title">For Gran</h2>
          <p className="row-body">
            The &ldquo;Hi Mum, new number&rdquo; text, the fake invoice, the &ldquo;pay me Friends and Family&rdquo;. Before money leaves,
            Spotter checks it and pings the grandkid she trusts. They can say hold on without ever having access to her
            account.
          </p>
        </section>
        <section className="row">
          <h2 className="row-title">For your kid</h2>
          <p className="row-body">
            Pocket money that works online, with your rules. Game credit from a stranger paid in gift card codes never goes
            through.
          </p>
        </section>
        <section className="row">
          <h2 className="row-title">How the money is held</h2>
          <p className="row-body">
            Spotter asks PayPal to authorise the payment, not take it. The money is held while the check runs and while your
            spotter decides. Approve and PayPal captures it. Deny and the hold is released. Every AI warning has to quote the
            exact words it came from, and code throws out any it can&rsquo;t point to.
          </p>
        </section>
      </div>

      <footer className="footer">
        Built for the PayPal AI Hackathon. Everything here runs in the PayPal sandbox with fake money.
      </footer>
    </main>
  );
}
