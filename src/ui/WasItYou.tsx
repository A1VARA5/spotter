// "Was it you?" on the dashboard and case file: who Spotter asked, and what they said. Client safe (types only
// from core, which uses node:crypto for tokens).
import { MessageCircleQuestion, UserRoundCheck, UserRoundX, PhoneCall } from "lucide-react";
import type { WasItYou } from "@/core/was-it-you";

export type WiyTone = "waiting" | "safe" | "claimed" | "ring";

/** The short state and the one plain sentence under it. */
export function wiyStatus(w: WasItYou, status: string, now = Date.now()): { tone: WiyTone; state: string; detail: string } {
  const example = w.channel === "example" ? "Example: " : "";
  switch (w.state) {
    case "asked":
      if (new Date(w.expiresAt).getTime() < now) {
        return { tone: "ring", state: `${example}${w.who} didn't answer`, detail: `The question ran out without an answer. Ring ${w.who} on the number you already have.` };
      }
      return w.channel === "alert"
        ? { tone: "waiting", state: `It says it's from you, ${w.who}`, detail: "Was it you? Answer Not me or Yes, it's me in your alert, or deny it here." }
        : { tone: "waiting", state: `${example}Asked ${w.who}`, detail: `Spotter asked ${w.who} if they sent it. Waiting for an answer.` };
    case "not_me":
      // Only "released" when PayPal really released it.
      if (status === "voided" || status === "voiding")
        return { tone: "safe", state: `${example}${w.who}: not me`, detail: `The message wasn't from ${w.who}, so Spotter released the hold. Nothing was paid.` };
      if (status === "captured" || status === "capturing")
        return { tone: "ring", state: `${example}${w.who}: not me`, detail: `${w.who} says it wasn't them, but it was already approved and paid. Ring the person who paid and report it to PayPal now.` };
      if (status === "needs_approval")
        return { tone: "ring", state: `${example}${w.who}: not me`, detail: `${w.who} says it wasn't them, but the hold wasn't released. Deny it now.` };
      return { tone: "ring", state: `${example}${w.who}: not me`, detail: `${w.who} says it wasn't them. Spotter won't pay this, but PayPal didn't confirm releasing the hold.` };
    case "it_was_me":
      return { tone: "claimed", state: `${example}${w.who}: it was me`, detail: `${w.who} says they sent it. Nothing is paid until you approve it with your PIN.` };
    case "no_channel":
      return { tone: "ring", state: `Says it's ${w.who}`, detail: `${w.who} has nothing linked to Spotter, so nobody was asked. Ring ${w.who} on the number you already have.` };
    case "send_failed":
      return { tone: "ring", state: `Couldn't reach ${w.who}`, detail: `It says it's from ${w.who}, but the question didn't send. Ring ${w.who} on the number you already have.` };
  }
}

const ICON = { waiting: MessageCircleQuestion, safe: UserRoundX, claimed: UserRoundCheck, ring: PhoneCall } as const;

export function WasItYouLine({ w, status }: { w: WasItYou | null | undefined; status: string }) {
  if (!w) return null;
  const s = wiyStatus(w, status);
  const Icon = ICON[s.tone];
  return (
    <div className="wiy-line" data-tone={s.tone}>
      <Icon className="wiy-line-icon" size={18} strokeWidth={1.9} aria-hidden="true" />
      <p>
        <strong>{s.state}.</strong> {s.detail}
        {w.claim.quote && <span className="wiy-line-quote"> The message says &quot;{w.claim.quote}&quot;.</span>}
      </p>
    </div>
  );
}
