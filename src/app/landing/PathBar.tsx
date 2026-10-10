// What Spotter is built on, shown as one payment riding Spotter's track: it passes each service in the order
// it meets them, PayPal's yellow clamp closes on it and it waits, then you decide. Pure CSS, loops slowly,
// pauses off screen, and stands still for reduced motion.
const STOPS = [
  { name: "Agentboxd", does: "brings the forwarded email in" },
  { name: "Claude", does: "reads it and looks into it" },
  { name: "Channel3", does: "checks what real shops charge" },
  { name: "PayPal", does: "holds the money", clamp: true },
  { name: "AG Grid", does: "keeps every decision on record" },
  { name: "You", does: "approve or deny" },
] as const;

export function PathBar() {
  return (
    <section className="ride" data-loop aria-label="What Spotter is built on, in the order a payment meets it">
      <span className="ride-glow" aria-hidden="true" />
      <div className="shell">
        <div className="ride-track">
          <span className="ride-line" aria-hidden="true" />
          <span className="ride-token num" aria-hidden="true">
            <span className="ride-token-amt">£250</span>
            <span className="ride-token-held">on hold</span>
          </span>
          <ol className="ride-stops">
            {STOPS.map((s, i) => (
              <li key={s.name} className="ride-stop" style={{ "--i": i } as React.CSSProperties} data-clamp={"clamp" in s || undefined}>
                <span className="ride-chip">
                  {"clamp" in s && (
                    <svg viewBox="0 0 16 26" width="10" height="16" aria-hidden="true">
                      <rect width="16" height="26" rx="6" fill="#f2b705" />
                      <path d="M5.75 8v10M10.25 8v10" stroke="#17212b" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  )}
                  {s.name}
                </span>
                <span className="ride-does">{s.does}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
