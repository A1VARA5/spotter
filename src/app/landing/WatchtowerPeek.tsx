"use client";
// Watchtower on the landing, built on AG Studio: the board Sam asks questions of, the AI's receipt under it (from AG
// Studio's own record of the run, with undo), and Gran's view of the same month in big type, in English or Polish.
// Drawn in Spotter's own style. Numbers are the demo family's sample month (src/watchtower/sample.ts); every word
// Gran sees is the simple view's own (copy.ts, checked by copy.test.ts).
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { BrandMark } from "@/ui/components";
import { GRAN_VIEW, RECEIPT, SAMPLE_BOARD, gbp } from "./copy";

const S = SAMPLE_BOARD;
const MAX = Math.max(S.paid, S.stopped);
const BARS = [
  { label: "Paid", value: S.paid / MAX, tone: "go", note: gbp(S.paid) },
  { label: "Stopped", value: S.stopped / MAX, tone: "stop", note: gbp(S.stopped) },
  { label: "Denied", value: S.denied / MAX, tone: "stop", note: gbp(S.denied) },
  { label: "Protected", value: S.protected / MAX, tone: "protect", note: gbp(S.protected) },
] as const;

type Lang = keyof typeof GRAN_VIEW;

export function WatchtowerPeek({ cta }: { cta: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  const v = GRAN_VIEW[lang];
  return (
    <section className="wt3" aria-labelledby="wt3-title">
      <div className="shell">
        <div className="wt3-head">
          <h2 id="wt3-title" className="wt3-title">
            Watchtower, built on AG Studio. <span>Ask about the month in plain words. The AI can&apos;t move money.</span>
          </h2>
        </div>

        <div className="wt3-stage">
          <div className="wt3-board-wrap">
            <div
              className="board"
              role="img"
              aria-label={`Example Watchtower board, sample month. Question: what did Spotter keep this month? Answer: ${gbp(S.kept)}, with payments by outcome. Under it, the AI's receipt: 4 calls, money actions 0, board changes 1, and a button to undo what Spotter changed.`}
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
                  <p className="board-label">Money kept, sample month</p>
                  <p className="board-big num">{gbp(S.kept)}</p>
                  <p className="board-note">{S.keptCount} payments stopped or denied</p>
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
              </div>
              <div className="wt3-receipt" aria-hidden="true">
                <span className="wt3-rc-title">
                  <b>Receipt</b> for your question at 09:14
                </span>
                <span>4 calls in 5.8 s</span>
                <span className="wt3-rc-money">
                  <i />
                  {RECEIPT.money}
                </span>
                <span>{RECEIPT.board}</span>
                <span className="wt3-rc-undo">Undo what Spotter changed</span>
                <span className="wt3-rc-more">Show the calls</span>
              </div>
            </div>
            <ul className="wt3-notes">
              <li>
                <b>The receipt is the AG Studio record, not the AI&apos;s word.</b> Spotter reads the run telemetry AG Studio keeps: which tools ran, how
                often, and whether any of them could move money. None can.
              </li>
              <li>
                <b>Undo puts the board back.</b> Every change one answer made comes off in one click, using the board history AG Studio keeps.
              </li>
            </ul>
          </div>

          <figure className="wt3-gran">
            <div className="wt3-phone" lang={lang === "pl" ? "pl" : "en"}>
              <p className="hp-gran-top">
                <BrandMark />
                Spotter
              </p>
              <p className="wt3-gran-h">{v.safeTitle}</p>
              <p className="wt3-gran-kept">
                {v.keptBefore}
                <b className="num">{gbp(S.granKept)}</b>
                {v.keptAfter}
              </p>
              <div className="wt3-gran-row">
                <span className="hp-gran-dot" aria-hidden="true" />
                <span>
                  <b className="num">£400.00</b> {v.to} New number (Hi Mum) <span className="wt3-sample">{v.sample}</span>
                  <i>{v.trick}</i>
                </span>
              </div>
              <div className="wt3-gran-receipt">
                <p className="hp-gran-rh">{v.receiptTitle}</p>
                <p>{v.looked}</p>
                <p className="hp-gran-money">{v.receiptMoney}</p>
              </div>
            </div>
            <figcaption>
              <span className="wt3-gran-cap">Gran&apos;s view: big type, plain words, nothing to approve. Sample month.</span>
              <span className="wt3-lang" role="group" aria-label="Gran's language">
                <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
                  English
                </button>
                <button type="button" aria-pressed={lang === "pl"} onClick={() => setLang("pl")} lang="pl">
                  Polski
                </button>
              </span>
            </figcaption>
          </figure>
        </div>

        <div className="wt3-end">{cta}</div>
      </div>
    </section>
  );
}
