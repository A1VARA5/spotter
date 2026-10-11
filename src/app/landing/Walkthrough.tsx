"use client";
// Gran's £250, start to finish: the hero's "it's Tom, new number" text (copy.ts, same amount, payee and words),
// followed along the hold track through the five stops it takes: forwarded, checked, held at PayPal, the real Tom
// asked, released with the record kept. Each stop shows a small piece of the real product. The other checks (two
// faces, real prices) sit as tabs inside the Checked stop, for texts that carry a link or a shop.
// Desktop: the steps scroll past a pinned stage whose track carries the money. Phones: the stops stack, each with its
// own picture, joined by the same track turned upright.
import { useEffect, useRef, useState } from "react";
import { Check, Hand, MessageSquareQuote, RotateCcw, Users } from "lucide-react";
import { Iphone } from "./Devices";
import { CheckViews } from "./Checks";
import { GranAskPhone } from "./HeroPhones";
import { GRAN, TOM } from "./copy";
import { BrandMark, Evidence } from "@/ui/components";
import { CaseFile } from "@/ui/CaseFile";
import type { Case } from "@/agents/case";
import type { Flag } from "@/core/grounding";

// The flags Spotter's example check quotes from this exact text (src/server/example-hold.ts, TOM_FLAGS).
export const STORY_FLAGS: Flag[] = [
  { kind: "impersonation", severity: "high", quote: "it's Tom, new number", why: "Someone on a new number says they're Tom. That's how the Hi Mum scam starts." },
  { kind: "pressure", severity: "medium", quote: "today", why: "It has to be today, so there's no time to check." },
  { kind: "other", severity: "medium", quote: "send £250 to my mate's account", why: "The money goes to a friend's account, not to Tom." },
];

const STOPS = [
  {
    key: "asked",
    title: "Forwarded",
    head: "Gran forwards the text instead of paying it.",
    body: "A new number says it's Tom and wants £250 sent to his mate's account today. Gran forwards it to Spotter in the chat app she already uses and asks if it's really him.",
  },
  {
    key: "checked",
    title: "Checked",
    head: "The AI has to quote the words that worried it.",
    body: "Her rules first: £250 is over the £50 she asked you to check, and she has never paid jamie.k1994@mail.example. Then an AI reads the text and quotes it word for word, and Spotter asks whether other families said no to that address.",
  },
  {
    key: "held",
    title: "Held at PayPal",
    head: "PayPal holds the £250. Nothing has left.",
    body: "Spotter asks PayPal to authorise the payment, not take it. The money is set aside on Gran's account. If nobody says yes, nothing is ever paid.",
  },
  {
    key: "decide",
    title: "Tom is asked",
    head: "The text says it's Tom, so Spotter asks Tom.",
    body: "Tom gets one question: did you message Gran from a new number asking for £250? A scammer can talk Gran past a warning. They can't answer on Tom's phone. Sam, Gran's spotter, gets the case too.",
  },
  {
    key: "done",
    title: "Released",
    head: "Tom taps Not me. PayPal lets the £250 go.",
    body: "Saying no needs no PIN. PayPal releases the hold and confirms it back to Spotter, Gran is told to ring Tom on the number she already has, and Watchtower keeps the record.",
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
            <span className="tg-fwd-from">Forwarded from {GRAN.from}</span>
            <span>{GRAN.text}</span>
            <span className="tg-mail">{GRAN.payee}</span>
            <i>09:12 ✓✓</i>
          </div>
          <div className="tg-msg tg-me">
            <span>Is this really Tom? x</span>
            <i>09:12 ✓✓</i>
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
  headline: "This looks like the Hi Mum scam. Someone on a new number says they're Tom and wants £250 sent to a friend's account today.",
  findings: [
    { tool: "payee_history", source: "c1", text: `Gran has never paid ${GRAN.payee} before.` },
    { tool: "network_reports", source: "c2", text: `In this example, 3 other families said no to ${GRAN.payee} in the last 30 days.` },
  ],
  ask: [],
  calls: [],
  dropped: 0,
  model: "",
  ms: 0,
};

function CheckedArt() {
  return (
    <div className="wk-panel wk-checked">
      <ul className="wk-rows">
        <li>
          <Hand size={17} strokeWidth={2} aria-hidden="true" />
          <span>
            <b>Her rules</b> Over the £50 she asked you to check. First time paying this address.
          </span>
        </li>
        <li>
          <MessageSquareQuote size={17} strokeWidth={2} aria-hidden="true" />
          <span>
            <b>AI check</b> Three warning signs, each quoted word for word.
          </span>
        </li>
        <li>
          <Users size={17} strokeWidth={2} aria-hidden="true" />
          <span>
            <b>Other families</b> Said no to this address before.
          </span>
        </li>
      </ul>
      <Evidence text={GRAN.text} flags={STORY_FLAGS} />
      <CaseFile c={CHECK_CASE} currency="GBP" />
    </div>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** The PayPal honour period runs about three days; the clock ticks only while someone can see it. */
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
    <span className="wk-clock num" role="timer" aria-label={`The PayPal hold expires in ${d} days ${h} hours`}>
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
        £250.00 <span>GBP</span>
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
          <dd>{GRAN.payee}</dd>
        </div>
      </dl>
      <div className="wk-pp-clock">
        <p>The PayPal hold expires in</p>
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

/** Tom's phone, before he answers: the one question, the words the text used, and two buttons. */
function DecideArt() {
  return (
    <div className="wk-duo">
      <Iphone scale={0.62} className="wk-phone">
        <div className="tg">
          <TgBar />
          <div className="tg-chat">
            <p className="wk-day">On Tom&apos;s phone</p>
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
          </div>
        </div>
      </Iphone>
      <div className="wk-swap">
        <p className="wk-swap-head">Sam, Gran&apos;s spotter</p>
        <p>
          <b>Gran wants to pay £250.00. It&apos;s on hold.</b> Spotter asked Tom if he sent it.
        </p>
        <span className="wk-swap-btn">Deny</span>
        <p className="wk-swap-pin">Approving needs Sam&apos;s PIN, so nobody can say yes for him.</p>
      </div>
    </div>
  );
}

/** After Not me: what Gran hears, and the line Watchtower keeps. */
function DoneArt() {
  return (
    <div className="wk-duo">
      <Iphone scale={0.62} className="wk-phone">
        <GranAskPhone />
      </Iphone>
      <div className="wk-record">
        <p className="wk-record-head">
          <BrandMark />
          Watchtower
        </p>
        <div className="wk-record-row">
          <span className="wk-dot" data-tone="go" aria-hidden="true" />
          <b>Gran</b>
          <b className="num">£250.00</b>
          <span className="wk-record-to">{GRAN.payee}</span>
        </div>
        <p className="wk-record-meta">Not me: Tom didn&apos;t send it. PayPal released the hold.</p>
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
  asked: { x: 0, label: "Forwarded" },
  checked: { x: 0.5, label: "Checking" },
  held: { x: 0.5, label: "On hold at PayPal" },
  decide: { x: 0.5, label: "Asking Tom" },
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
          <span className="wk-coin num">£250</span>
        </span>
      </div>
      <div className="wk-ends">
        <span>Gran</span>
        <span className="wk-state">{TRACK[k].label}</span>
        <span>{GRAN.payee}</span>
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
          Gran&apos;s £250, start to finish
        </h2>
        <p className="sec-lede wk-lede">Follow the &quot;it&apos;s Tom, new number&quot; text from Gran&apos;s forward to Tom&apos;s Not me. Every payment takes these stops.</p>

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
