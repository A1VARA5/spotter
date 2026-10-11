// What Spotter found for a hold a tripwire let go: what the agent reached for and the line that could have caused it.
// Shown where a case file would be (the dashboard's sheet, the Activity drawer). Page text is plain text, never markup.
import type { Payment } from "@/core/lifecycle";
import { CAUSE_LABEL, isLabSpenderId, tripOf, tripOutcome } from "@/core/tripped";
import "./toolkit.css";

export function TripFound({ p, lead = true }: { p: Pick<Payment, "status" | "decided_by" | "tripwire" | "spender_id">; lead?: boolean }) {
  const kind = tripOf(p);
  const o = tripOutcome(p);
  if (!kind || !o) return null;
  const t = p.tripwire;
  const lab = isLabSpenderId(p.spender_id);
  return (
    <section className="trip-found" aria-label="What Spotter found">
      {lead && <p className="trip-found-lead">{o.explain}</p>}
      <div className="ah-block">
        <p className="ah-block-title">What set it off</p>
        {kind === "decoy" ? (
          <p className="ah-block-sub">Someone sent the decoy key planted in the agent&apos;s settings. Nothing legitimate ever sends it, so its secrets leaked.</p>
        ) : t ? (
          <p className="ah-block-sub">
            It reached for the PayPal tool <code>{t.tool}</code>. Its job never needs it, so Spotter never ran it and the call never reached PayPal.
          </p>
        ) : (
          <p className="ah-block-sub">Spotter had paused this agent, but its record of what set that off wasn&apos;t found. Check the agent&apos;s card on the dashboard.</p>
        )}
      </div>
      {kind === "tripwire" && (
        <div className="ah-block">
          <p className="ah-block-title">What could have caused it</p>
          {t?.cause?.quote ? (
            <>
              <p className="ah-block-sub">
                {CAUSE_LABEL[t.cause.kind] ?? "A line it read"}
                {t.cause.toolName ? ` (${t.cause.toolName})` : ""}, while paying {t.cause.payee}:
              </p>
              <blockquote className="ah-quote">{t.cause.quote}</blockquote>
            </>
          ) : (
            <p className="ah-block-sub">Spotter has no record of a line that could have caused it. Ask whoever set the agent up what it was doing.</p>
          )}
        </div>
      )}
      {lab && (
        <p className="trip-found-lab">
          <span className="ah-lab-tag">Test agent</span> This was the agent lab&apos;s scripted naive test agent, not one of your people. <a href="/agent-lab">See the run</a>
        </p>
      )}
    </section>
  );
}
