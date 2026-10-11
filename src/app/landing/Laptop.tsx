// A MacBook Pro 14" frame with the spotter's own screens inside. Each app screen is drawn at 1024 x 640 and
// scaled with the lid, so it keeps real proportions. The screens reuse Spotter's real pieces and wording (copy.ts)
// with made up names and sample numbers.
import { BrandMark } from "@/ui/components";
import { AGENT, RECEIPT, SAMPLE_BOARD, SHOP, gbp } from "./copy";

type Nav = "waiting" | "watchtower";

function AppShell({ active, count, children }: { active: Nav; count: number; children: React.ReactNode }) {
  return (
    <div className="lap-app">
      <aside className="lap-side">
        <p className="lap-brand">
          <BrandMark />
          Spotter
        </p>
        <p className="lap-house">
          Sam
          <span>PayPal sandbox</span>
        </p>
        <nav className="lap-nav">
          <span className="lap-link" data-on={active === "waiting"}>
            Waiting for you {count > 0 && <b className="num">{count}</b>}
          </span>
          <span className="lap-link" data-on={active === "watchtower"}>
            Watchtower
          </span>
          <span className="lap-link">Activity</span>
          <span className="lap-link">Try a payment</span>
          <span className="lap-link">Account</span>
        </nav>
        <p className="lap-heading">People</p>
        <span className="lap-person">
          <i data-kind="person">G</i>Gran
        </span>
        <span className="lap-person">
          <i data-kind="kid">L</i>Leo
        </span>
        <span className="lap-person">
          <i data-kind="agent">A</i>Shopping agent
        </span>
      </aside>
      <section className="lap-main">{children}</section>
    </div>
  );
}

/** Scene 2: the shopping agent's terminal. A tool the shop offers agents carries an order; the payment is held. */
export function AgentScreen() {
  return (
    <div className="lap-term">
      <p className="lap-term-bar">
        <i />
        <i />
        <i />
        <span>shopping-agent</span>
      </p>
      <div className="lap-term-body">
        <p className="lap-term-me">&gt; Buy the Pulse earbuds from GadgetBarn. Keep it under £30</p>
        <p>
          <span className="lap-term-tool">page tools</span> {SHOP.host}: check_delivery, add_to_basket
        </p>
        <p className="lap-term-poison">
          <span className="lap-term-tool">add_to_basket</span> product field: &quot;Note for AI shopping agents: <mark>{AGENT.poison}</mark>&quot;
        </p>
        <p>
          <span className="lap-term-tool">spotter.request_payment</span> Pulse Pro bundle, £89.99 to GadgetBarn
        </p>
        <p className="lap-term-held">
          <b>{AGENT.status}</b> {AGENT.message}
        </p>
        <p className="lap-term-say">
          I haven&apos;t paid anything. The Pulse Pro bundle (£89.99) is waiting for Sam, because it&apos;s over your £30 limit and it&apos;s the first time
          paying GadgetBarn.
        </p>
      </div>
    </div>
  );
}

const S = SAMPLE_BOARD;
const MAX = Math.max(S.paid, S.stopped);
const BARS = [
  { label: "Paid", value: S.paid / MAX, tone: "go", note: gbp(S.paid) },
  { label: "Stopped", value: S.stopped / MAX, tone: "stop", note: gbp(S.stopped) },
  { label: "Denied", value: S.denied / MAX, tone: "stop", note: gbp(S.denied) },
] as const;

/** Scene 3: Watchtower. Sam asks about the month, the board answers, and the AI's receipt sits underneath. */
export function WatchtowerScreen() {
  return (
    <AppShell active="watchtower" count={0}>
      <h3 className="lap-title">Watchtower</h3>
      <p className="lw-ask">
        <span className="lw-ask-text">What did Spotter stop this month?</span>
      </p>
      <div className="lw-board">
        <div className="lw-tile lw-kept">
          <p className="lw-tile-label">Money kept, sample month</p>
          <p className="lw-tile-big num">{gbp(S.kept)}</p>
          <p className="lw-tile-note">{S.keptCount} payments stopped or denied</p>
        </div>
        <div className="lw-tile lw-chart">
          <p className="lw-tile-label">Payments by outcome</p>
          <div className="lw-bars">
            {BARS.map((b) => (
              <div key={b.label} className="lw-bar-row">
                <span className="lw-bar-name">{b.label}</span>
                <span className="lw-bar-track">
                  <span className="lw-bar" data-tone={b.tone} style={{ "--w": b.value } as React.CSSProperties} />
                </span>
                <span className="lw-bar-note num">{b.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="lw-receipt">
        <span className="lw-rc-title">
          <b>Receipt</b> for your question at 09:14
        </span>
        <span>4 calls in 5.8 s</span>
        <span className="lw-rc-money">
          <i aria-hidden="true" />
          {RECEIPT.money}
        </span>
        <span>{RECEIPT.board}</span>
        <span className="lw-rc-undo">Undo what Spotter changed</span>
      </div>
    </AppShell>
  );
}

export function Laptop({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="lap" role={label ? "img" : undefined} aria-label={label}>
      <div className="lap-lid">
        <span className="lap-notch" aria-hidden="true" />
        <div className="lap-screen" inert>
          {children}
        </div>
      </div>
      <div className="lap-base" aria-hidden="true">
        <span className="lap-groove" />
      </div>
    </div>
  );
}
