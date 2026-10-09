// The channel hub and the closing call to action, shared by the landing and the product shots.
import { BrandMark } from "@/ui/components";

export function Hub() {
  return (
    <section className="hub-sec" aria-labelledby="hub-title">
      <div className="shell">
        <h2 id="hub-title" className="sec-title reveal">
          Nobody installs anything new
        </h2>
        <p className="sec-lede reveal">They keep using email, Telegram or their AI agent. Everything flows through one check before it reaches PayPal.</p>
        <div className="hub">
          <div className="hub-in">
            <div className="hub-card reveal">
              <p className="hub-label">Email</p>
              <div className="hub-snip hub-mail">
                <span>
                  To: <b>spotter@homingbox.net</b>
                </span>
                <span>Fwd: Your parcel is waiting</span>
              </div>
              <p className="hub-note">Forward anything that asks for money. Only connected addresses get an answer.</p>
            </div>
            <div className="hub-card reveal">
              <p className="hub-label">Telegram</p>
              <div className="hub-snip hub-tg">
                <span className="hub-tg-out">/start SPOT-7KQ2XM</span>
                <span className="hub-tg-in">Paired. Send me anything that asks Gran for money.</span>
              </div>
              <p className="hub-note">One tap pairs Gran&apos;s phone. You get Approve and Deny in yours.</p>
            </div>
            <div className="hub-card reveal">
              <p className="hub-label">AI agents</p>
              <div className="hub-snip hub-term">
                <span>
                  <i>$</i> claude mcp add spotter …/api/mcp
                </span>
                <span className="hub-term-ok">4 tools: find products, request payment, payment status, my allowance</span>
              </div>
              <p className="hub-note">Each agent gets its own key. It can ask to pay. It can never approve.</p>
            </div>
          </div>
          <svg className="hub-lines" viewBox="0 0 900 140" preserveAspectRatio="none" aria-hidden="true">
            <path d="M150 0 C150 80 450 60 450 140" />
            <path d="M450 0 L450 140" />
            <path d="M750 0 C750 80 450 60 450 140" />
          </svg>
          <div className="hub-core">
            <span className="hub-mark">
              <BrandMark />
            </span>
            <span>
              <b>Spotter checks</b> rules, AI evidence, real prices
            </span>
          </div>
          <svg className="hub-lines hub-lines-out" viewBox="0 0 900 80" preserveAspectRatio="none" aria-hidden="true">
            <path d="M450 0 L450 80" />
          </svg>
          <div className="hub-out">
            <span className="hub-pp">PayPal</span>
            <span>holds, pays or releases the money</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Final({ children }: { children: React.ReactNode }) {
  return (
    <section className="final">
      <div className="shell final-inner reveal">
        <div className="final-track" aria-hidden="true">
          <span className="final-rail" />
          <span className="final-coin num">£250</span>
          <span className="final-clamp">
            <BrandMark />
          </span>
        </div>
        <h2 className="final-title">Try it on fake money.</h2>
        <p className="final-lede">The demo family has Gran, Leo and a shopping agent ready. Or log in with a PayPal sandbox account and set up your own.</p>
        {children}
      </div>
    </section>
  );
}
