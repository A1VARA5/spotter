// The phones in the hero scenes, laid out at iPhone points like the rest of Devices.tsx. The chat app is a generic
// one, the people and shops are examples, and every message Spotter sends is quoted from the product (copy.ts).
import { BrandMark } from "@/ui/components";
import { AGENT, GRAN, GRAN_VIEW, SAMPLE_BOARD, TOM, gbp } from "./copy";

function BotBar() {
  return (
    <div className="tg-bar">
      <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true">
        <path d="M10 2 2 10l8 8" stroke="#0a84ff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="tg-av">
        <BrandMark />
      </span>
      <span className="tg-who">
        <b>Spotter</b>
        <i>bot</i>
      </span>
    </div>
  );
}

/** Scene 1, Gran's phone: she forwards the "new number" text to Spotter, and hears back twice. */
export function GranAskPhone() {
  return (
    <div className="tg hp-chat">
      <BotBar />
      <div className="tg-chat">
        <p className="wk-day">Today</p>
        <div className="tg-msg tg-me tg-fwd">
          <span className="tg-fwd-from">Forwarded from {GRAN.from}</span>
          <span>{GRAN.text}</span>
          <span className="tg-mail">{GRAN.payee}</span>
          <i>09:12 ✓✓</i>
        </div>
        <div className="tg-msg tg-me">
          <span>Is this really Tom? x</span>
          <i>09:12 ✓✓</i>
        </div>
        <div className="tg-msg tg-bot hp-held">
          <span>{GRAN.held}</span>
          <i>09:12</i>
        </div>
        <div className="tg-msg tg-bot tg-bot-ok hp-safe">
          <span>
            <b>{GRAN.notMe.split(". ").slice(0, 2).join(". ")}.</b> {GRAN.notMe.split(". ").slice(2).join(". ")}
          </span>
          <i>09:13</i>
        </div>
      </div>
    </div>
  );
}

/** Scene 1, Tom's phone: Spotter asks the person the text claims to be. */
export function TomPhone() {
  return (
    <div className="tg hp-chat">
      <BotBar />
      <div className="tg-chat">
        <div className="tg-msg tg-bot hp-ask">
          <span>
            <b>{TOM.question}</b>
          </span>
          <span>{TOM.quote}</span>
          <span>PayPal is holding Gran&apos;s money while we check. If it wasn&apos;t you, tap Not me and it&apos;s released straight away.</span>
          <i>09:12</i>
        </div>
        <div className="hp-keys" aria-hidden="true">
          <span className="hp-key hp-key-no">Not me</span>
          <span className="hp-key">Yes, it&apos;s me</span>
        </div>
        <div className="tg-msg tg-me hp-tom-said">
          <span>Not me</span>
          <i>09:13 ✓✓</i>
        </div>
        <div className="tg-msg tg-bot hp-tom-thanks">
          <span>{TOM.thanks}</span>
          <i>09:13</i>
        </div>
      </div>
    </div>
  );
}

/** Scene 2, Sam's phone: the alert for the agent's held payment, with the line the shop wrote for agents. */
export function SamAlertPhone() {
  return (
    <div className="tg hp-chat">
      <BotBar />
      <div className="tg-chat">
        <div className="tg-msg tg-bot hp-alert">
          <span>
            <b>Shopping agent wants to pay £89.99. It&apos;s on hold.</b>
          </span>
          <span>To GadgetBarn, for the Pulse Pro bundle. PayPal is holding the money until you decide.</span>
          <span>
            The shop offers AI agents a tool, &quot;add_to_basket&quot;, with a line written to steer the agent:{" "}
            <mark className="hp-mark">&quot;{AGENT.poison}&quot;</mark>
          </span>
          <i>11:04</i>
        </div>
        <div className="wk-keys hp-alert-keys" aria-hidden="true">
          <span className="wk-key wk-key-deny">Deny</span>
          <span className="wk-key">Review and approve</span>
        </div>
      </div>
    </div>
  );
}

/** Scene 3, Gran's view of Watchtower: big type, plain words, nothing to approve. Sample month. */
export function GranViewPhone() {
  const v = GRAN_VIEW.en;
  return (
    <div className="hp-gran">
      <p className="hp-gran-top">
        <BrandMark />
        Spotter
      </p>
      <p className="hp-gran-h">{v.safeTitle}</p>
      <p className="hp-gran-kept">
        {v.keptBefore}
        <b className="num">{gbp(SAMPLE_BOARD.granKept)}</b>
        {v.keptAfter}
      </p>
      <div className="hp-gran-row">
        <span className="hp-gran-dot" aria-hidden="true" />
        <span>
          <b className="num">£400.00</b> {v.to} New number (Hi Mum)
          <i>{v.trick}</i>
        </span>
      </div>
      <div className="hp-gran-receipt">
        <p className="hp-gran-rh">{v.receiptTitle}</p>
        <p>{v.looked}</p>
        <p className="hp-gran-money">{v.receiptMoney}</p>
      </div>
      <span className="hp-gran-sample">{v.sample}</span>
    </div>
  );
}
