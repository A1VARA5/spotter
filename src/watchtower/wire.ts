// Watchtower's sources travel from the server as JSON, where Dates become text. Studio wants real Dates.
import type { PaymentRow, PaypalRow, Sources, WatchRow } from "./data";

type Dated<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] extends Date ? string : T[P] extends Date | null ? string | null : T[P] };
export type WireSources = {
  payments: Array<Dated<PaymentRow, "when" | "paypalExpires">>;
  signs: Array<Dated<Sources["signs"][number], "when">>;
  people: Sources["people"];
  paypal?: Array<Dated<PaypalRow, "when">>;
  watches?: Array<Dated<WatchRow, "started">>;
};

export function revive(w: WireSources): Sources {
  return {
    payments: w.payments.map((r) => ({ ...r, when: new Date(r.when), paypalExpires: r.paypalExpires ? new Date(r.paypalExpires) : null })),
    signs: w.signs.map((r) => ({ ...r, when: new Date(r.when) })),
    people: w.people,
    ...(w.paypal ? { paypal: w.paypal.map((r) => ({ ...r, when: new Date(r.when) })) } : {}),
    ...(w.watches ? { watches: w.watches.map((r) => ({ ...r, started: new Date(r.started) })) } : {}),
  };
}
