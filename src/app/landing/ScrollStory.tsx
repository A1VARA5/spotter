"use client";
// The story of one payment, told on one phone that stays on screen while you scroll. It follows the real "Hi Mum"
// pattern (a text from a stranger's number, then the ask on WhatsApp, as Which? reports it) and the way Spotter
// really works: Gran forwards the ask to Spotter, PayPal holds the money, her spotter decides.
import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Hand } from "lucide-react";
import { Iphone, IosActions, IosNotification, LockScreen, SCAM, SmsScreen, TelegramScreen, WhatsAppScreen, type TgStep } from "./Devices";
import { Evidence, HoldTrack } from "@/ui/components";
import type { Flag } from "@/core/grounding";

const STEPS = [
  { title: "A text from a number Gran doesn't know.", body: "\"Hi mum, I'm texting you off a friend's phone, I've smashed mine.\" It's one of the most reported family scams in the UK, and it always moves to WhatsApp." },
  { title: "On WhatsApp, the ask.", body: "A bill to pay today, can't get into the banking, so send £250 to a mate's PayPal instead. Kind people pay this in minutes." },
  { title: "Gran forwards it to Spotter.", body: "That's the one habit you set up with her: anything that asks for money goes to Spotter on Telegram first. Or by email, if she prefers." },
  { title: "Spotter checks, and PayPal holds the money.", body: "Her rules first, then an AI check that must quote the exact words that worried it. PayPal authorises the £250 but doesn't take it." },
  { title: "Your phone lights up.", body: "Who, how much, to whom, and why it looks wrong. Approving needs your PIN, so nobody else can say yes for you." },
  { title: "You say no. Gran hears it from Spotter.", body: "PayPal releases the hold. Spotter tells her in the same chat, and to call James on the number she already has." },
] as const;

const ASK = SCAM.whatsapp[3].text;
const FLAGS: Flag[] = [
  { kind: "impersonation", severity: "high", quote: "cant get into my banking", why: "" },
  { kind: "pressure", severity: "medium", quote: "has to be paid today", why: "" },
  { kind: "other", severity: "high", quote: "send £250 to my mate Jamie's PayPal", why: "" },
];

const TG: Record<number, TgStep> = { 2: "checking", 3: "held", 4: "held", 5: "denied" };

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

  const screen = step === 0 ? "sms" : step === 1 ? "wa" : "tg";

  return (
    <section className="story" data-loop aria-labelledby="story-title">
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
          <p className="story-source">Message wording follows the &ldquo;Hi Mum&rdquo; texts reported by Which?. Names and numbers are made up.</p>
        </div>

        <div className="story-stage" aria-hidden="true">
          <div className="story-sticky">
            <div className="story-phones" data-yours={step === 4}>
              <Iphone scale={0.74} className="story-phone story-gran">
                <div className="screens">
                  <div className="screen" data-on={screen === "sms"}>
                    <SmsScreen />
                  </div>
                  <div className="screen" data-on={screen === "wa"}>
                    <WhatsAppScreen />
                  </div>
                  <div className="screen" data-on={screen === "tg"}>
                    <TelegramScreen step={TG[step] ?? "forwarded"} />
                  </div>
                </div>
              </Iphone>
              <Iphone dark scale={0.74} className="story-phone story-you">
                <LockScreen>
                  <IosNotification title="Gran wants to pay £250" body="To jamie.k1994@gmail.com, a first time payee. It looks like the Hi Mum scam. The money is on hold." />
                  <IosActions items={[{ label: "Approve £250" }, { label: "Deny", tone: "danger" }, { label: "Open Spotter" }]} />
                </LockScreen>
              </Iphone>

              <div className="spot-card" data-show={step === 3}>
                <p className="spot-card-head">Spotter checked</p>
                <ul className="spot-rows">
                  <li data-on={step >= 3}>
                    <Hand size={16} strokeWidth={2} />
                    <span>
                      <b>Her rules</b> Over the £50 she asked you to check. First payment to this address.
                    </span>
                  </li>
                  <li data-on={step >= 3}>
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
                  <Evidence text={ASK} flags={FLAGS} />
                </div>
                <HoldTrack state="held" from="Gran" to="jamie.k1994@" amount={25000} currency="GBP" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
