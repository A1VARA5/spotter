"use client";
// "Was it you?", side by side: Gran's phone gets the scam text, Tom's phone gets Spotter's question. A judge has no
// second phone, so Tom's is drawn here and labelled Example. The hold behind it is real: starting makes a PayPal
// sandbox authorisation for the demo family, and Not me on Tom's phone really voids it.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircleOff, ShieldCheck } from "lucide-react";
import { Iphone, SmsScreen } from "@/app/landing/Devices";
import { BrandMark } from "@/ui/components";
import { plainError, readJson } from "@/ui/http";
import type { WasItYou } from "@/core/was-it-you";
import { messageSays } from "@/core/userText";
import "./demo.css";

type Phase = "idle" | "starting" | "asked" | "answering" | "not_me" | "it_was_me";
type PublicPayment = { id: string; status: string; amount: number | string; payee: string; was_it_you: WasItYou | null };

const SCAM_NUMBER = "+44 7700 900183";
const SCAM_TEXT =
  "Hi Mum it's Tom, new number. My phone broke and I can't get into my banking. Can you send £250 to my mate's account today? I'll pay you back tomorrow x";

/** Two phones fit side by side at 390 px at this scale; bigger from a small tablet up. */
function usePhoneScale() {
  // Starts small so the first paint never overflows a phone screen; grows once the width is known.
  const [scale, setScale] = useState(0.34);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 620px)");
    // At 320 px the two phones at 0.37 ran 2 px past the screen edge.
    const tiny = window.matchMedia("(max-width: 359px)");
    const set = () => setScale(tiny.matches ? 0.34 : narrow.matches ? 0.37 : 0.56);
    set();
    narrow.addEventListener("change", set);
    tiny.addEventListener("change", set);
    return () => {
      narrow.removeEventListener("change", set);
      tiny.removeEventListener("change", set);
    };
  }, []);
  return scale;
}

export function WasItYouDemo({ spotter, resume }: { spotter: string; resume?: { payment: PublicPayment; token: string } | null }) {
  const scale = usePhoneScale();
  // An example still waiting for Tom (a reload, or coming back from the dashboard) picks up where it was left.
  const [phase, setPhase] = useState<Phase>(resume ? "asked" : "idle");
  const [payment, setPayment] = useState<PublicPayment | null>(resume?.payment ?? null);
  const [token, setToken] = useState<string | null>(resume?.token ?? null);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const result = useRef<HTMLParagraphElement>(null);
  const notMe = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  // After each step, focus lands where the news is: Tom's Not me button, then the result line.
  useEffect(() => {
    if (n === 0) return; // never steal focus on page load, even when resuming
    if (phase === "asked") notMe.current?.focus();
    if (phase === "not_me" || phase === "it_was_me") result.current?.focus();
  }, [phase, n]);

  async function start() {
    if (phase === "starting") return;
    setPhase("starting");
    setError(null);
    setReply(null);
    try {
      const r = await fetch("/api/demo/was-it-you", { method: "POST" });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `That didn't start (${r.status}).`);
      setPayment(j.payment);
      setToken(j.token);
      setPhase("asked");
      setN((x) => x + 1);
      router.refresh(); // the new hold joins the sidebar's "Waiting for you" count
    } catch (e) {
      setError(plainError(e));
      setPhase("idle");
    }
  }

  async function answer(a: "not_me" | "it_was_me") {
    if (!token || phase !== "asked") return;
    setPhase("answering");
    setError(null);
    try {
      const r = await fetch("/api/was-it-you", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, answer: a }) });
      const j = await readJson(r);
      if (j.payment) setPayment(j.payment);
      if (!r.ok) {
        // Answered or decided somewhere else (another tab, the dashboard): show what really happened.
        const state = j.payment?.was_it_you?.state;
        setReply(j.reply ?? j.error ?? null);
        if (state === "not_me" || state === "it_was_me") {
          setPhase(state);
          setN((x) => x + 1);
          return;
        }
        throw new Error(j.error ?? `That didn't go through (${r.status}).`);
      }
      setReply(j.reply);
      setPhase(a);
      setN((x) => x + 1);
      router.refresh(); // Not me released it: the sidebar count follows
    } catch (e) {
      setError(plainError(e));
      setPhase("asked");
    }
  }

  const status = payment?.status;
  const released = phase === "not_me" && status === "voided";
  const held = phase === "asked" || phase === "answering" || (phase === "it_was_me" && status === "needs_approval");
  const track = phase === "idle" ? null : phase === "starting" ? "Making the hold" : released ? "Released by PayPal" : held ? "On hold at PayPal" : status === "captured" ? "Paid" : "Settled";

  // What Spotter shows on Gran's phone: one card that changes as Tom answers.
  const granCard: { tone: "hold" | "safe"; big: string; small: string } | null =
    phase === "starting"
      ? { tone: "hold", big: "Checking", small: "Spotter is looking at this before any money goes." }
      : phase === "asked" || phase === "answering"
        ? { tone: "hold", big: "£250 on hold", small: "Checking with Tom. Don't send anything yet." }
        : phase === "not_me"
          ? released
            ? { tone: "safe", big: "Your money is safe", small: "It wasn't Tom. Ring Tom on the number you already have." }
            : { tone: "hold", big: "Tom said not me", small: reply ?? "" }
          : phase === "it_was_me"
            ? { tone: "hold", big: "Still on hold", small: `Tom says it was him. Nothing is paid until ${spotter} approves it.` }
            : null;

  return (
    <section className="wiy-demo" aria-labelledby="wiy-title">
      <div className="wiy-head">
        <h2 id="wiy-title" className="section-title">
          Was it you?
        </h2>
        <p className="wiy-lede">
          A text says it&apos;s Tom, Gran&apos;s son, and asks her for £250. Banks ask the person paying &quot;was this you?&quot;. Spotter asks Tom.
        </p>
        <p className="wiy-lede wiy-lede-small">
          Here the text names Tom, so Tom is asked on his phone. When a text just says &quot;Hi Mum&quot;, it claims to be from you, {spotter}, so
          Spotter asks you on the held payment instead. That&apos;s the Hi Mum example below.
        </p>
      </div>

      <div className="wiy-stage" data-phase={phase}>
        <figure className="wiy-phone">
          <Iphone scale={scale} className="wiy-iphone">
            <div className="wiy-gran">
              <SmsScreen number={SCAM_NUMBER} text={SCAM_TEXT} at="09:12" />
              {granCard && (
                <div className="wiy-card" key={granCard.big} data-tone={granCard.tone}>
                  <span className="wiy-card-from">
                    <BrandMark /> Spotter
                  </span>
                  <p className="wiy-card-big">
                    {granCard.tone === "safe" && <ShieldCheck size={30} strokeWidth={2.2} aria-hidden="true" />}
                    {granCard.big}
                  </p>
                  <p className="wiy-card-small">{granCard.small}</p>
                </div>
              )}
            </div>
          </Iphone>
          <figcaption>
            Gran&apos;s phone <span className="wiy-tag">Example</span>
          </figcaption>
        </figure>

        <div className="wiy-track" aria-hidden="true">
          <span className="wiy-track-line" />
          {track && <span className="wiy-track-pill">{track}</span>}
        </div>

        <figure className="wiy-phone">
          <Iphone scale={scale} className="wiy-iphone">
            <div className="tg wiy-tom">
              <div className="tg-bar wiy-tom-bar">
                <span />
                <span className="tg-av">
                  <BrandMark />
                </span>
                <span className="tg-who">
                  <b>Spotter</b>
                  <i>bot</i>
                </span>
              </div>
              <div className="tg-chat wiy-tom-chat">
                {phase === "idle" && (
                  <div className="wiy-empty">
                    <MessageCircleOff size={28} strokeWidth={1.8} aria-hidden="true" />
                    <p>No messages yet. Tom doesn&apos;t know about the text.</p>
                  </div>
                )}
                {phase === "starting" && (
                  <div className="tg-msg tg-bot tg-typing" aria-label="Spotter is typing">
                    <span className="tg-dots">
                      <b />
                      <b />
                      <b />
                    </span>
                  </div>
                )}
                {phase !== "idle" && phase !== "starting" && (
                  <div className="tg-msg tg-bot wiy-ask" key={n}>
                    <span>
                      <b>Did you message Gran from a new number asking for £250?</b>
                    </span>
                    <span>{messageSays(payment?.was_it_you?.claim.quote ?? "it's Tom")} PayPal is holding Gran&apos;s money while we check.</span>
                    <i>09:12</i>
                  </div>
                )}
                {(phase === "asked" || phase === "answering") && (
                  <div className="wiy-kb" role="group" aria-label="Answer as Tom">
                    <button ref={notMe} className="wiy-kb-btn" data-tone="no" onClick={() => answer("not_me")} aria-disabled={phase === "answering" || undefined}>
                      {phase === "answering" ? "Sending" : "Not me"}
                    </button>
                    <button className="wiy-kb-btn" onClick={() => answer("it_was_me")} aria-disabled={phase === "answering" || undefined}>
                      Yes, it&apos;s me
                    </button>
                  </div>
                )}
                {(phase === "not_me" || phase === "it_was_me") && (
                  <>
                    <div className="tg-msg tg-me">
                      <span>{phase === "not_me" ? "Not me" : "Yes, it's me"}</span>
                      <i>09:13 ✓✓</i>
                    </div>
                    {reply && (
                      <div className="tg-msg tg-bot">
                        <span>{reply}</span>
                        <i>09:13</i>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </Iphone>
          <figcaption>
            Tom&apos;s phone <span className="wiy-tag">Example</span>
          </figcaption>
        </figure>
      </div>

      <div className="wiy-foot">
        <p ref={result} tabIndex={-1} className="wiy-result" role="status" data-tone={released ? "safe" : phase === "it_was_me" ? "hold" : undefined}>
          {phase === "idle" && "Gran and Tom are made up, the hold is real: starting makes a £250 PayPal sandbox hold for this demo family."}
          {phase === "starting" && "Gran forwarded it. Holding £250 at PayPal and asking Tom."}
          {(phase === "asked" || phase === "answering") && "PayPal is holding £250 for real (sandbox). Answer as Tom on his phone."}
          {phase === "not_me" &&
            (released
              ? `Tom said not me, so PayPal released the £250 hold straight away. Nothing was paid, and ${spotter} didn't need the PIN to stop it.`
              : (reply ?? "Tom said not me."))}
          {phase === "it_was_me" &&
            (status === "needs_approval"
              ? `Tom said it was him. That never pays anything: the £250 is still on hold until ${spotter} approves it with the PIN.`
              : (reply ?? "Tom said it was him."))}
        </p>
        {error && (
          <p className="error-line" role="alert">
            {error}
          </p>
        )}
        <div className="wiy-actions">
          {phase === "idle" || phase === "starting" ? (
            <button className="btn btn-primary" onClick={start} aria-disabled={phase === "starting" || undefined}>
              {phase === "starting" ? "Holding £250" : "Gran forwards it to Spotter"}
            </button>
          ) : phase === "not_me" || phase === "it_was_me" ? (
            <>
              <Link className={phase === "it_was_me" ? "btn btn-primary" : "btn btn-quiet"} href={payment ? `/dashboard#pay-${payment.id}` : "/dashboard"}>
                {phase === "it_was_me" ? "Review it on the dashboard" : "See it on the dashboard"}
              </Link>
              <button className="scen-again" onClick={start}>
                Run it again
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
