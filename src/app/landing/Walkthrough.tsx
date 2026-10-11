"use client";
// One payment, start to finish: Gran's £79 for a "clearance" tablet, followed along the hold track through the
// five stops every payment takes. Each stop names what does the work and shows a small piece of the real product.
// Desktop: the steps scroll past a pinned stage whose track carries the money. Phones: the stops stack, each with its
// own picture, joined by the same track turned upright.
import { useEffect, useRef, useState } from "react";
import { Check, Hand, MessageSquareQuote, RotateCcw } from "lucide-react";
import { Iphone } from "./Devices";
import { CheckViews } from "./Checks";
import { BrandMark, Evidence } from "@/ui/components";
import { CaseFile } from "@/ui/CaseFile";
import type { Case } from "@/agents/case";
import type { Flag } from "@/core/grounding";

const SHOP = "Tablet Clearance Outlet";
const SHOP_HOST = "tabletclearance-outlet.shop";
const EMAIL = "Clearance: 10.2 inch tablet, last 3 at this price. Was £249, now £79 with free delivery. Offer ends at midnight, order here:";
const FLAGS: Flag[] = [
  { kind: "pressure", severity: "medium", quote: "Last 3 at this price", why: "Rushing her so she doesn't check." },
  { kind: "pressure", severity: "medium", quote: "Offer ends at midnight", why: "Rushing her so she doesn't check." },
];

const STOPS = [
  {
    key: "asked",
    title: "Asked",
    head: "Gran forwards an offer she isn't sure about.",
    body: "A text about a £79 tablet that's £249 everywhere else. She forwards it to Spotter in the chat app she already uses. Email and AI agents work the same way.",
  },
  {
    key: "checked",
    title: "Checked",
    head: "Spotter checks it the way you would, only faster.",
    body: "Her rules first. Then an AI reads the message and has to quote the exact words that worried it. Spotter opens the link safely, looks up real shop prices and asks whether other families said no.",
  },
  {
    key: "held",
    title: "Held at PayPal",
    head: "PayPal holds the £79. Nothing has left.",
    body: "Spotter asks PayPal to authorise the payment, not take it. The money is reserved on Gran's account and the PayPal countdown starts. If nobody approves, nothing is ever paid.",
  },
  {
    key: "decide",
    title: "You decide",
    head: "Your phone gets the whole case.",
    body: "One tap Deny in your chat app. Approving opens Spotter and needs your PIN, so nobody can say yes for you. When the same thing is for sale at a genuine shop, Spotter offers that instead.",
  },
  {
    key: "done",
    title: "Paid or released",
    head: "PayPal confirms it, and the record stays.",
    body: "You said no, so PayPal releases the hold and confirms it back to Spotter. Gran hears it in the same chat, and Watchtower keeps the record.",
  },
] as const;

type Key = (typeof STOPS)[number]["key"];

/* ---------- the five pictures ---------- */

function AskedArt() {
  return (
    <Iphone scale={0.62} className="wk-phone">
      <div className="tg">
        <TgBar />
        <div className="tg-chat">
          <p className="wk-day">Last week</p>
          <div className="tg-msg tg-bot">
            <span>
              <b>Gran is connected to Spotter.</b> From now on, forward me anything that asks you for money. I&apos;ll check it and tell you here.
            </span>
            <i>10:12</i>
          </div>
          <p className="wk-day">Today</p>
          <div className="tg-msg tg-me tg-fwd">
            <span className="tg-fwd-from">Forwarded from +44 7700 900128</span>
            <span>{EMAIL}</span>
            <span className="tg-mail">{SHOP_HOST}/deal</span>
            <i>13:58 ✓✓</i>
          </div>
          <div className="tg-msg tg-me">
            <span>Is this one alright? It&apos;s for the grandkids&apos; videos x</span>
            <i>13:58 ✓✓</i>
          </div>
          <div className="tg-msg tg-bot tg-typing" aria-label="Spotter is checking">
            <span className="tg-dots">
              <b />
              <b />
              <b />
            </span>
          </div>
        </div>
      </div>
    </Iphone>
  );
}

const CHECK_CASE: Case = {
  status: "done",
  verdict: "likely_scam",
  headline: "Almost certainly a fake shop. The tablet costs £229 or more at real retailers, and the link ends up somewhere else.",
  findings: [
    { tool: "find_genuine_offer", source: "c1", text: "Real shops sell this tablet from £229, around £239 across 6 retailers." },
    { tool: "network_reports", source: "c2", text: "In this example, 7 other Spotter families said no to this shop in the last 30 days." },
  ],
  ask: [],
  page: {
    url: `https://${SHOP_HOST}/deal`,
    finalUrl: "https://pay-secure-checkout.example/card",
    title: "Checkout",
    asks: { card: true, login: false, giftCard: false },
  },
  calls: [],
  dropped: 0,
  model: "",
  ms: 0,
};

function ShopShot() {
  return (
    <div className="kshot" role="img" aria-label="What the link showed: a checkout page asking for card details">
      <p className="kshot-url">
        <span className="kshot-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>pay-secure-checkout.example/card</span>
      </p>
      <p className="kshot-bar">
        <span className="kshot-logo" aria-hidden="true" />
        Secure checkout
      </p>
      <div className="kshot-body">
        <p className="kshot-h">Pay £79.00</p>
        <span className="kshot-field">Card number</span>
        <span className="kshot-row">
          <span className="kshot-field">MM / YY</span>
          <span className="kshot-field">CVV</span>
        </span>
        <span className="kshot-btn">Pay now</span>
      </div>
    </div>
  );
}

function CheckedArt() {
  return (
    <div className="wk-panel wk-checked">
      <ul className="wk-rows">
        <li>
          <Hand size={17} strokeWidth={2} aria-hidden="true" />
          <span>
            <b>Her rules</b> Over the £50 she asked you to check. First time paying this shop.
          </span>
        </li>
        <li>
          <MessageSquareQuote size={17} strokeWidth={2} aria-hidden="true" />
          <span>
            <b>AI check</b> Two warning signs, quoted word for word. No hidden text for an AI in this one.
          </span>
        </li>
      </ul>
      <Evidence text={EMAIL} flags={FLAGS} />
      <CaseFile c={CHECK_CASE} currency="GBP" pageShot={<ShopShot />} />
    </div>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** PayPal's honour period runs about three days; the clock ticks only while someone can see it. */
function HoldClock({ live }: { live: boolean }) {
  const [left, setLeft] = useState(3 * 86400 - 14);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [live]);
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  return (
    <span className="wk-clock num" role="timer" aria-label={`PayPal's hold expires in ${d} days ${h} hours`}>
      {d}d {pad(h)}h {pad(m)}m {pad(left % 60)}s
    </span>
  );
}

function HeldArt({ live }: { live: boolean }) {
  return (
    <div className="wk-panel wk-pp">
      <header className="wk-pp-head">
        <span className="hub-pp">PayPal</span>
        <span className="wk-pp-kind">Authorisation</span>
        <span className="wk-pp-badge">
          <i aria-hidden="true" />
          On hold
        </span>
      </header>
      <p className="wk-pp-amount num">
        £79.00 <span>GBP</span>
      </p>
      <dl className="wk-pp-facts">
        <div>
          <dt>Status</dt>
          <dd>Authorised, not captured</dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>Gran, PayPal sandbox</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{SHOP}</dd>
        </div>
      </dl>
      <div className="wk-pp-clock">
        <p>PayPal&apos;s hold expires in</p>
        <HoldClock live={live} />
        <span className="wk-pp-bar" aria-hidden="true">
          <i />
        </span>
      </div>
      <p className="wk-pp-note">
        <Check size={16} strokeWidth={2.4} aria-hidden="true" />
        Nothing has left Gran&apos;s account.
      </p>
    </div>
  );
}

function TgBar({ who = "Spotter" }: { who?: string }) {
  return (
    <div className="tg-bar">
      <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true">
        <path d="M10 2 2 10l8 8" stroke="#0a84ff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="tg-av">
        <BrandMark />
      </span>
      <span className="tg-who">
        <b>{who}</b>
        <i>bot</i>
      </span>
    </div>
  );
}

function Alert() {
  return (
    <div className="tg-msg tg-bot wk-alert">
      <span>
        <b>Gran wants to pay £79.00. It&apos;s on hold.</b>
      </span>
      <span>To {SHOP}. PayPal is holding the money until you decide.</span>
      <span>Almost certainly a fake shop. The tablet costs £229 or more at real retailers.</span>
      <span>• In this example, 7 other Spotter families said no to this shop.</span>
      <i>14:02</i>
    </div>
  );
}

function SamHistory() {
  return (
    <>
      <p className="wk-day">Yesterday</p>
      <div className="tg-msg tg-bot">
        <span>
          <b>Spotter stopped £8.00 from Leo.</b>
        </span>
        <span>To xX_cheapcoins_Xx. Gift card codes can&apos;t be undone, so this one is never allowed.</span>
        <i>16:03</i>
      </div>
      <p className="wk-day">Today</p>
    </>
  );
}

function DecideArt() {
  return (
    <div className="wk-duo">
      <Iphone scale={0.62} className="wk-phone">
        <div className="tg">
          <TgBar />
          <div className="tg-chat">
            <SamHistory />
            <Alert />
            <div className="wk-keys" aria-hidden="true">
              <span className="wk-key wk-key-deny">Deny</span>
              <span className="wk-key">Review and approve</span>
            </div>
          </div>
        </div>
      </Iphone>
      <div className="wk-swap">
        <p className="wk-swap-head">The case agent found the real thing</p>
        <p>
          <b>10.2 inch tablet, 64GB</b> is £229.00 at everythingstore.example.
        </p>
        <span className="wk-swap-btn">Deny this, buy it from everythingstore.example</span>
        <p className="wk-swap-pin">Approving anything needs your PIN.</p>
      </div>
    </div>
  );
}

function DoneArt() {
  return (
    <div className="wk-duo">
      <Iphone scale={0.62} className="wk-phone">
        <div className="tg">
          <TgBar />
          <div className="tg-chat">
            <SamHistory />
            <Alert />
            <div className="tg-msg tg-bot tg-bot-ok">
              <span>
                <b>Denied.</b> PayPal released the hold on {SHOP}. Nothing was paid, and Gran has been told.
              </span>
              <i>14:03</i>
            </div>
            <div className="tg-msg tg-bot">
              <span>PayPal confirmed: £79.00 released back to Gran.</span>
              <i>14:03</i>
            </div>
          </div>
        </div>
      </Iphone>
      <div className="wk-record">
        <p className="wk-record-head">
          <BrandMark />
          Watchtower
        </p>
        <div className="wk-record-row">
          <span className="wk-dot" data-tone="stop" aria-hidden="true" />
          <span>
            <b>Gran</b> {SHOP}
          </span>
          <b className="num">£79.00</b>
        </div>
        <p className="wk-record-meta">Denied by Sam, released by PayPal</p>
        <p className="wk-record-ask">&quot;How much did Spotter keep this month?&quot;</p>
      </div>
    </div>
  );
}

function Art({ k, live }: { k: Key; live: boolean }) {
  if (k === "asked") return <AskedArt />;
  if (k === "checked") return <CheckedArt />;
  if (k === "held") return <HeldArt live={live} />;
  if (k === "decide") return <DecideArt />;
  return <DoneArt />;
}

/* ---------- the track ---------- */

const TRACK: Record<Key, { x: number; label: string }> = {
  asked: { x: 0, label: "Asked" },
  checked: { x: 0.5, label: "Checking" },
  held: { x: 0.5, label: "On hold at PayPal" },
  decide: { x: 0.5, label: "Waiting for you" },
  done: { x: 0, label: "Released back to Gran" },
};

function Track({ k }: { k: Key }) {
  return (
    <div className="wk-track" data-k={k}>
      <div className="wk-rail">
        <span className="wk-line" />
        <span className="wk-gate" aria-hidden="true">
          {k === "done" ? <RotateCcw size={16} strokeWidth={2.2} /> : <span className="wk-clamp" />}
        </span>
        <span className="wk-coin-layer" style={{ "--x": TRACK[k].x } as React.CSSProperties}>
          <span className="wk-coin num">£79</span>
        </span>
      </div>
      <div className="wk-ends">
        <span>Gran</span>
        <span className="wk-state">{TRACK[k].label}</span>
        <span>{SHOP_HOST}</span>
      </div>
    </div>
  );
}

export function Walkthrough({ cta }: { cta: React.ReactNode }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    const seen = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)));
    if (root.current) seen.observe(root.current);
    return () => {
      io.disconnect();
      seen.disconnect();
    };
  }, []);

  const k = STOPS[step]!.key;

  return (
    <section ref={root} id="walkthrough" className="wk" aria-labelledby="wk-title">
      <div className="shell">
        <h2 id="wk-title" className="sec-title wk-title">
          One payment, start to finish
        </h2>
        <p className="sec-lede wk-lede">Follow Gran&apos;s £79 from the moment she asks to the moment it&apos;s settled. Every payment takes the same five stops.</p>

        <div className="wk-grid">
          <ol className="wk-stops">
            {STOPS.map((s, i) => (
              <li
                key={s.key}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-step={i}
                data-active={i === step}
                data-k={s.key}
                className="wk-stop"
              >
                <span className="wk-n num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="wk-copy">
                  <p className="wk-stop-name">{s.title}</p>
                  <h3>{s.head}</h3>
                  <p>{s.body}</p>
                </div>
                <div className="wk-inline" aria-hidden="true" inert>
                  <Art k={s.key} live={false} />
                </div>
                {/* Phones: after Gran's own case file. Desktop: under the stop's words, beside the pinned case file. */}
                {s.key === "checked" && (
                  <div className="wk-more">
                    <CheckViews />
                  </div>
                )}
              </li>
            ))}
          </ol>

          {/* Decorative copies of the stops above: inert, so nothing inside is a hidden tab stop (axe aria-hidden-focus). */}
          <div className="wk-stage" aria-hidden="true" inert>
            <div className="wk-sticky">
              <Track k={k} />
              <div className="wk-arts">
                {STOPS.map((s) => (
                  <div key={s.key} className="wk-art" data-on={s.key === k}>
                    <Art k={s.key} live={visible && s.key === k} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="wk-end">
          <p>The demo family has Gran, Leo and a shopping agent ready to try this on fake money.</p>
          {cta}
        </div>
      </div>
    </section>
  );
}
