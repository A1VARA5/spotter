// What Spotter says about which AI checked a payment, in one place for the case file, the held card and the
// evidence pack. Plain strings only, so client components can import them.

/** No AI could answer at all (no usable Anthropic key, Anthropic down, and the backup model failed or is off). */
export const AI_DOWN_LINE = "The AI check is down right now, so Spotter held this for you. Nothing is paid.";

/** The scam check was written by the backup model because Claude couldn't answer. */
export const BACKUP_LINE = "Checked by the backup AI model, because Claude was unavailable.";
