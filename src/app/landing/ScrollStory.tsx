"use client";
// The story of one payment, told on one phone that stays on screen while you scroll. Each step of text that
// reaches the middle of the screen moves the phone to its next state, so the page reads as one continuous scene.
import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Hand } from "lucide-react";
import { IMessage, Iphone, IosActions, IosNotification, LockScreen, PayPalSheet, type SheetState } from "./Devices";
import { Evidence, HoldTrack } from "@/ui/components";
import type { Flag } from "@/core/grounding";

const STEPS = [
  {
    title: "Gran gets a text from a new number.",
    body: "It sounds like her son. It asks for Friends and Family, which has no protection if it goes wrong, and it's in a hurry.",
  },
  { title: "She does what anyone kind would do.", body: "She opens PayPal and taps send. Without Spotter, the £250 would be gone in a second." },
  {
    title: "Spotter checks before anything moves.",
    body: "Her rules first, then an AI check that has to quote the exact words that worried it. Code throws out any warning it can't point to.",
  },
  { title: "PayPal holds the money.", body: "Spotter asks PayPal to authorise the payment, not take it. The £250 is reserved while someone she trusts looks." },
  {
    title: "Your phone lights up.",
    body: "You see who, how much, and why. Press and hold to approve or deny. Approving needs your PIN, so nobody else can say yes for you.",
  },
  { title: "You say no. Nothing is lost.", body: "PayPal releases the hold. Gran is told in plain words, and to call her son on the number she already has." },
] as const;

const TEXT =
  "Hi Mum it's me, dropped my phone in the bath so this is my new number. Can you send £250 to my mate's PayPal, Friends and Family so there's no fee. Please hurry it's urgent x";
const FLAGS: Flag[] = [
  { kind: "impersonation", severity: "high", quote: "this is my new number", why: "" },
  { kind: "friends_and_family", severity: "high", quote: "Friends and Family so there's no fee", why: "" },
  { kind: "pressure", severity: "medium", quote: "Please hurry it's urgent", why: "" },
];

const SHEET: Record<number, SheetState | null> = { 0: null, 1: "pay", 2: "checking", 3: "held", 4: "held", 5: "released" };

export function ScrollStory() {
  const [step, setStep] = useState(0);
  const refs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const sheet = SHEET[step];
  const yours = step === 4;

  return (
    <section className="story" aria-labelledby="story-title">
      <div className="shell story-grid">
        <div className="story-steps">
          <h2 id="story-title" className="sec-title story-title">
            One payment, start to finish
          </h2>
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              ref={(el) => {
                refs.current[i] = el;
              }}
              data-step={i}
              data-active={i === step}
              className="story-step"
            >
              <span className="story-n num">{i + 1}</span>
              <div className="story-card">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="story-stage" aria-hidden="true">
          <div className="story-sticky">
            <div className="story-phones" data-yours={yours}>
              <Iphone scale={0.74} className="story-phone story-gran">
                <IMessage text={TEXT} />
                <div className="story-sheet" data-open={sheet !== null}>
                  <PayPalSheet state={sheet ?? "pay"} />
                </div>
              </Iphone>
              <Iphone dark scale={0.74} className="story-phone story-you">
                <LockScreen>
                  <IosNotification
                    title="Gran wants to pay £250"
                    body="A new number asked her for Friends and Family. The money is on hold until you decide."
                  />
                  <IosActions items={[{ label: "Approve £250" }, { label: "Deny", tone: "danger" }, { label: "Open Spotter" }]} />
                </LockScreen>
              </Iphone>
              <div className="spot-card" data-show={step === 2 || step === 3}>
                <p className="spot-card-head">Spotter checked</p>
                <ul className="spot-rows">
                  <li data-on={step >= 2}>
                    <Hand size={16} strokeWidth={2} />
                    <span>
                      <b>Her rules</b> Over the £50 she asked you to check, and a first time payee.
                    </span>
                  </li>
                  <li data-on={step >= 2}>
                    <CircleAlert size={16} strokeWidth={2} />
                    <span>
                      <b>The message</b> 3 warning signs, each quoted word for word.
                    </span>
                  </li>
                  <li data-on={step >= 3}>
                    <Check size={16} strokeWidth={2.4} />
                    <span>
                      <b>PayPal</b> £250 authorised, not taken.
                    </span>
                  </li>
                </ul>
                <div className="spot-evidence">
                  <Evidence text={TEXT} flags={FLAGS} />
                </div>
                <HoldTrack state="held" from="Gran" to="mate.payments" amount={25000} currency="GBP" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
