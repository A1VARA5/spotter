"use client";
// "Was it you?" on the dashboard and case file: who Spotter asked, and what they said. When the question is the
// spotter's own (the message says it's from them) or the Try demo's example left behind, the answer buttons are
// right here, so nobody needs an alert channel to answer. Types only from core (it uses node:crypto for tokens).
import { useState } from "react";
import { MessageCircleQuestion, UserRoundCheck, UserRoundX, PhoneCall } from "lucide-react";
import type { WasItYou } from "@/core/was-it-you";
import { plainError, readJson } from "./http";
import "./wasityou.css";

export type WiyTone = "waiting" | "safe" | "claimed" | "ring";

/**
 * The short state, the one plain sentence under it, and whether the answer buttons belong here: "here" for the
 * spotter's own question, "as" for the demo's example (answering as Tom).
 */
export function wiyStatus(w: WasItYou, status: string, now = Date.now()): { tone: WiyTone; state: string; detail: string; answer?: "here" | "as" } {
  const example = w.channel === "example" ? "Example: " : "";
  const waiting = status === "needs_approval";
  switch (w.state) {
    case "asked":
      if (new Date(w.expiresAt).getTime() < now) {
        return w.channel === "example"
          ? { tone: "ring", state: `${example}${w.who} didn't answer`, detail: `The example question ran out, so the money is still on hold. Deny it to release it.` }
          : { tone: "ring", state: `${example}${w.who} didn't answer`, detail: `The question ran out without an answer. Ring ${w.who} on the number you already have.` };
      }
      if (w.channel === "alert") {
        // Why it's the spotter being asked, in the same story as the Try page (where the text names Tom instead).
        const why = w.claim.name ? "The message uses your name." : "It's written as if from their son or daughter (it calls them Mum or Dad), and that's you.";
        return { tone: "waiting", state: `It says it's from you, ${w.who}`, detail: `${why} Was it you?`, answer: waiting ? "here" : undefined };
      }
      if (w.channel === "example") {
        return {
          tone: "waiting",
          state: `${example}Asked ${w.who}`,
          detail: `On Try a payment, Spotter asked ${w.who} if he sent it. Answer for him here, or deny it.`,
          answer: waiting ? "as" : undefined,
        };
      }
      return { tone: "waiting", state: `Asked ${w.who}`, detail: `Spotter asked ${w.who} if they sent it. Waiting for an answer.` };
    case "not_me":
      if (w.channel === "alert") {
        // The spotter answered their own question: talk to them as "you".
        const released = status === "voided" || status === "voiding";
        return released
          ? { tone: "safe", state: "You said not me", detail: "So Spotter released the hold. Nothing was paid." }
          : { tone: "ring", state: "You said not me", detail: waiting ? "But the hold wasn't released. Deny it now." : "Spotter won't pay this." };
      }
      // Only "released" when PayPal really released it.
      if (status === "voided" || status === "voiding")
        return { tone: "safe", state: `${example}${w.who}: not me`, detail: `The message wasn't from ${w.who}, so Spotter released the hold. Nothing was paid.` };
      if (status === "captured" || status === "capturing")
        return { tone: "ring", state: `${example}${w.who}: not me`, detail: `${w.who} says it wasn't them, but it was already approved and paid. Ring the person who paid and report it to PayPal now.` };
      if (waiting) return { tone: "ring", state: `${example}${w.who}: not me`, detail: `${w.who} says it wasn't them, but the hold wasn't released. Deny it now.` };
      return { tone: "ring", state: `${example}${w.who}: not me`, detail: `${w.who} says it wasn't them. Spotter won't pay this, but PayPal didn't confirm releasing the hold.` };
    case "it_was_me":
      if (w.channel === "alert") return { tone: "claimed", state: "You said it was you", detail: "Nothing is paid until you approve it with your PIN." };
      return { tone: "claimed", state: `${example}${w.who}: it was me`, detail: `${w.who} says they sent it. Nothing is paid until you approve it with your PIN.` };
    case "no_channel":
      return { tone: "ring", state: `Says it's ${w.who}`, detail: `${w.who} has nothing linked to Spotter, so nobody was asked. Ring ${w.who} on the number you already have.` };
    case "send_failed":
      return { tone: "ring", state: `Couldn't reach ${w.who}`, detail: `It says it's from ${w.who}, but the question didn't send. Ring ${w.who} on the number you already have.` };
  }
}

const ICON = { waiting: MessageCircleQuestion, safe: UserRoundX, claimed: UserRoundCheck, ring: PhoneCall } as const;

/** now is the dashboard's clock (the server's on the first render), so "didn't answer" can't flip during hydration. */
export function WasItYouLine({ w, status, paymentId, now }: { w: WasItYou | null | undefined; status: string; paymentId?: string; now: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!w) return null;
  const s = wiyStatus(w, status, now);
  const Icon = ICON[s.tone];
  // The payment id comes from the card's own anchor when the caller doesn't pass it.
  async function answer(a: "not_me" | "it_was_me", el: HTMLElement) {
    const id = paymentId ?? el.closest("[id^='pay-']")?.id.slice(4);
    if (busy) return;
    if (!id) {
      console.error("[spotter] was it you answer: no payment id on this card");
      setError("Spotter couldn't tell which payment this is. Reload the page and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/payments/${id}/was-it-you`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: a }) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `That didn't go through (${r.status}).`);
      // Say what really happened now; the dashboard's polling brings the new state within a few seconds.
      setDone(j.reply ?? "Answer saved.");
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wiy-line" data-tone={s.tone}>
      <Icon className="wiy-line-icon" size={18} strokeWidth={1.9} aria-hidden="true" />
      <div className="wiy-line-body">
        <p>
          <strong>{s.state}.</strong> {s.detail}
          {w.claim.quote && <span className="wiy-line-quote"> The message says &quot;{w.claim.quote}&quot;.</span>}
        </p>
        {done && (
          <p className="wiy-line-note" role="status">
            {done}
          </p>
        )}
        {s.answer && !done && (
          <div className="wiy-line-answer" role="group" aria-label={s.answer === "as" ? `Answer as ${w.who}` : "Was it you?"}>
            <button type="button" className="btn btn-quiet wiy-line-btn" onClick={(e) => answer("not_me", e.currentTarget)} aria-disabled={busy || undefined}>
              {s.answer === "as" ? `${w.who}: not me` : "Not me"}
            </button>
            <button type="button" className="btn btn-quiet wiy-line-btn" onClick={(e) => answer("it_was_me", e.currentTarget)} aria-disabled={busy || undefined}>
              {s.answer === "as" ? `${w.who}: it was me` : "Yes, it was me"}
            </button>
            <span className="wiy-line-note">{busy ? "Sending" : "Not me releases the hold. Yes never pays: approving still needs your PIN."}</span>
          </div>
        )}
        {error && (
          <p className="error-line" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
