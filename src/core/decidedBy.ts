// Who let a hold go when no person did: kept apart from lifecycle.ts so screens can read them without the database.

/** decided_by on a hold Spotter let go because a tripwire paused the agent. */
export const PAUSED_BY = "Spotter (the agent was paused)";
/** decided_by on a hold Spotter let go because PayPal answered late: nobody decided it, so nobody is told they did. */
export const LATE_BY = "Spotter (PayPal answered late)";
export const LATE_HOLD = "PayPal answered too late, so Spotter let the hold go. Nothing was paid.";
/** The error a hold gets when PayPal let it lapse before an approved payment was taken. */
export const LAPSED_HOLD = "PayPal let the hold lapse before the payment went through. Nothing was paid.";
/** The error on a hold PayPal says it captured while Spotter was letting it go (an earlier capture won the race). */
export const CAPTURED_WHILE_RELEASING = "PayPal says this hold was captured, although it was being let go. Check it in PayPal.";
