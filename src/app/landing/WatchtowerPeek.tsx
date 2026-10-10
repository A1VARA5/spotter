// Watchtower on the landing: a drawn board in Spotter's own style. Ask a question, Spotter's agent builds the chart.
// The numbers are the demo family's sample month (src/watchtower/sample.ts), with money kept counted the way the
// real widget counts it: stopped plus denied.
import { Sparkles } from "lucide-react";
import { BrandMark } from "@/ui/components";

const MAX = 711.97;
const BARS = [
  { label: "Paid", value: 687.59 / MAX, tone: "go", note: "£687.59" },
  { label: "Stopped", value: 1, tone: "stop", note: "£711.97" },
  { label: "Denied", value: 220.99 / MAX, tone: "stop", note: "£220.99" },
  { label: "Protected", value: 85 / MAX, tone: "protect", note: "£85.00" },
] as const;

export function WatchtowerPeek({ cta }: { cta: React.ReactNode }) {
  return (
    <section className="wt2" aria-labelledby="wt2-title">
      <div className="shell wt2-grid">
        <div className="wt2-copy">
          <h2 id="wt2-title" className="sec-title">
            Watchtower, the family&apos;s board
          </h2>
          <p className="sec-lede">Every decision lands on a board built on AG Studio. Ask it a question in plain words and Spotter&apos;s agent builds the chart.</p>
          <div>{cta}</div>
        </div>

        <div
          className="board"
          role="img"
          aria-label="Watchtower board. Question: what did Spotter keep this month? Answer: £932.96, with a chart of payments by outcome and two watch alerts. Sample month."
        >
          <p className="board-top" aria-hidden="true">
            <BrandMark />
            Watchtower
            <span>Sam&apos;s family</span>
          </p>
          <p className="board-ask" aria-hidden="true">
            <Sparkles size={17} strokeWidth={1.9} />
            What did Spotter keep this month?
          </p>
          <div className="board-grid" aria-hidden="true">
            <div className="board-tile">
              <p className="board-label">Money kept</p>
              <p className="board-big num">£932.96</p>
              <p className="board-note">7 payments stopped or denied</p>
            </div>
            <div className="board-tile">
              <p className="board-label">Payments by outcome</p>
              <div className="board-bars">
                {BARS.map((b) => (
                  <div key={b.label} className="board-bar">
                    <span>{b.label}</span>
                    <span className="board-bar-track">
                      <span className="board-bar-fill" data-tone={b.tone} style={{ "--w": b.value } as React.CSSProperties} />
                    </span>
                    <span className="num">{b.note}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="board-tile board-wide">
              <p className="board-answer">
                <b>Spotter kept £932.96 this month.</b> The biggest was Gran&apos;s £400 to a &quot;new number&quot;, stopped this morning. You denied two more, and an
                £85 Friends and Family payment was never sent.
              </p>
              <ul className="board-alerts">
                <li>
                  <span className="wk-dot" />
                  <span>Gran: £400 to a new number pretending to be family, stopped</span>
                </li>
                <li>
                  <span className="wk-dot" />
                  <span>Leo: a free coins site asked for a gift card code, stopped</span>
                </li>
              </ul>
            </div>
          </div>
          <p className="board-sample" aria-hidden="true">
            Sample month, the same one the demo family starts with.
          </p>
        </div>
      </div>
    </section>
  );
}
