// Try a payment's inline result: when to keep looking for the case file, and when it has the seen vs read evidence.
import type { Payment } from "@/core/lifecycle";
import { kernelLead } from "@/ui/caseFold";
import { trackState } from "@/ui/format";

/** The case agent is capped at 45 s after the payment is decided; a little longer covers the round trips. */
export const CASE_WAIT_MS = 60_000;

const GETS_A_CASE = new Set(["held", "blocked", "protected"]);

/** True while a case file can still arrive for this payment: it was held, stopped or protected and has none yet. */
export function caseStillComing(p: Payment, sentAt: number, now: number): boolean {
  return GETS_A_CASE.has(trackState(p.status)) && !p.case_file && now - sentAt < CASE_WAIT_MS;
}

/** The opened page, only when it hid orders for the agent from people (the "what a person sees vs what your agent read" panes). */
export function seenPage(p: Payment) {
  const page = p.case_file?.page;
  return page && kernelLead(page)?.kind === "seen" ? page : null;
}
