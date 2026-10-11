// "PayPal's agent tools, with a spotter": a real run, shortened. On 10 October 2026 an agent using PayPal's
// official Agent Toolkit (1.11.0) called create_order through Spotter, and Spotter held it for approval
// (transcript in paypal-spotter-submission/toolkit-agent-run-2026-10-10.json). The product's model name is
// replaced with a plain description; everything else is as it ran.
export function AgentToolkit({ connectHref, cta }: { connectHref: string; cta: React.ReactNode }) {
  return (
    <section id="agents" className="agent-sec" aria-labelledby="agent-title">
      <div className="shell agent-grid">
        <div className="agent-copy">
          <h2 id="agent-title" className="sec-title">
            PayPal agent tools, with a spotter
          </h2>
          <p className="sec-lede agent-why">
            The PayPal Agent Toolkit lets an AI agent create and pay orders, with <b>no spending limit and no approval step</b>. Point the agent at Spotter
            instead and every order goes through the same check, then waits for you.
          </p>
          <div className="agent-ctas">
            <a className="btn btn-hold" href={connectHref}>
              Connect your agent
            </a>
            {cta}
          </div>
        </div>

        <figure className="agent-run">
          <div className="aterm" role="img" aria-label="A shopping agent calls create_order from the PayPal Agent Toolkit for 119 dollars. Spotter answers HELD_FOR_APPROVAL, and the agent tells the user Sam has to approve it first.">
            <p className="aterm-bar" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>shopping-agent, PayPal Agent Toolkit 1.11.0 through Spotter</span>
            </p>
            <div className="aterm-body" aria-hidden="true">
              <p className="aterm-user">Please buy me the noise cancelling earbuds from this page and pay for them.</p>
              <p className="aterm-call">
                <b>create_order</b> {"{ currencyCode: \"USD\", items: [{ name: \"Noise cancelling earbuds\", itemCost: 119, quantity: 1 }] }"}
              </p>
              <div className="aterm-res">
                <span className="aterm-held">HELD_FOR_APPROVAL</span>
                <span>amount US$119.00, paypal_order_id 8DD59221E7921940H</span>
                <span className="aterm-dim">Held, not paid yet: Sam has to approve US$119.00. Reasons: Over the US$30.00 &quot;ask me first&quot; limit. First time paying this shop.</span>
              </div>
              <p className="aterm-say">
                <b>Agent:</b> I created the order for the earbuds ($119.00, free shipping), but it hasn&apos;t been paid yet. Sam needs to approve it first because
                it&apos;s over the $30 &quot;ask me first&quot; limit and it&apos;s the first payment to this shop.
              </p>
            </div>
          </div>
          <figcaption className="aterm-cap">A real run on the PayPal sandbox on 10 October 2026, shortened. The order exists at PayPal; the money doesn&apos;t move until Sam says yes.</figcaption>
        </figure>
      </div>
    </section>
  );
}
