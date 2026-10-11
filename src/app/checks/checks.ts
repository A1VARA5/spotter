// "How Spotter checked it": one row per engine, what it does in plain words, and a live example from this family
// (the latest case that used it, linked) or an honest empty state with a Try scenario that shows it. Pure, so the
// page and the tests agree. Quotes come from the family's own payments and are shown as text, never as markup.
import type { Payment } from "@/core/lifecycle";
import { money, trackState } from "@/ui/format";
import { OUTCOME_WORDS } from "@/ui/labels";
import { peekableHost } from "@/ui/peekable";
import { BACKUP_LINE } from "@/core/aiwords";

export type CheckPayment = Pick<
  Payment,
  "id" | "spender_id" | "status" | "amount" | "currency" | "created_at" | "request" | "ai" | "market" | "case_file" | "paypal_authorization_id"
>;
export type EngineId = "ai" | "kernel" | "channel3" | "watchtower" | "activity" | "paypal";
export type Example = {
  text: string;
  href: string;
  label: string;
  example?: boolean;
  shows?: string[];
  evidence?: string;
  /** KERNEL's own screenshot of the page (only a JPEG data URL Spotter made). */
  thumb?: { src: string; alt: string };
  /** A live, read only look at that page again (src/ui/Peek.tsx), when the server would allow one. */
  peek?: { paymentId: string; host: string };
};
export type Engine = { id: EngineId; name: string; by: string; does: string; example: Example | null; empty: { text: string; href: string; label: string } };
export type Extras = { lastEvent: { type: string; paymentId: string } | null; demo: boolean };

const newest = (ps: CheckPayment[], f: (p: CheckPayment) => boolean) =>
  ps.filter(f).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
const cut = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "the page";
  }
};
const caseLink = (p: CheckPayment) => `/dashboard#pay-${p.id}`;
// Only a JPEG data URL Spotter made itself is ever put in an img src (the same rule as the case file).
const SHOT = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

const EVENT_WORDS: Record<string, string> = {
  "PAYMENT.AUTHORIZATION.CREATED": "PayPal confirmed the hold",
  "PAYMENT.AUTHORIZATION.VOIDED": "PayPal confirmed it released the hold, nothing was paid",
  "PAYMENT.CAPTURE.COMPLETED": "PayPal confirmed it paid",
  "PAYMENT.CAPTURE.DECLINED": "PayPal said it declined the payment",
  "PAYMENT.CAPTURE.REFUNDED": "PayPal confirmed a refund",
};

export function engines(payments: CheckPayment[], names: Record<string, string>, extras: Extras): Engine[] {
  const who = (p: CheckPayment) => names[p.spender_id] ?? "Someone";
  const what = (p: CheckPayment) => `${who(p)}'s ${money(p.amount, p.currency)} to ${p.request.payee.name}`;
  const isExample = (p: CheckPayment) => p.case_file?.example === true || undefined;

  const ai = newest(payments, (p) => p.ai?.ok === true);
  const aiFlags = ai?.ai?.flags.filter((f) => f.quote) ?? [];
  const kernel = newest(payments, (p) => Boolean(p.case_file?.page));
  const page = kernel?.case_file?.page;
  const shows = page
    ? [
        page.seen && "what a person sees vs what the agent read",
        page.tools && "tools the page offers AI agents",
        (page.faces || page.phone) && "two faces: desktop and phone",
        page.trail && "where the money goes",
      ].filter((s): s is string => Boolean(s))
    : [];
  const priced = newest(payments, (p) => Boolean(p.market?.cheapest) || Boolean(p.case_file?.spot));
  const held = newest(payments, (p) => Boolean(p.paypal_authorization_id));
  // Only PayPal's word about that same payment, so the line never mixes two cases.
  const event = held && extras.lastEvent?.paymentId === held.id ? extras.lastEvent : null;
  const n = payments.length;

  return [
    {
      id: "ai",
      name: "Spotter's AI check",
      by: "Claude",
      does: "Reads the message or shop page as untrusted text and has to quote every warning sign word for word. Code throws out any warning it can't find in the message.",
      example: ai
        ? {
            text:
              (aiFlags.length
                ? `${what(ai)}: ${aiFlags.length} warning sign${aiFlags.length === 1 ? "" : "s"}, quoted from the message: "${cut(aiFlags[0]!.quote, 70)}"`
                : `${what(ai)}: nothing in the message looked wrong.`) + (ai.ai?.aiEngine === "openai_backup" ? ` ${BACKUP_LINE}` : ""),
            href: caseLink(ai),
            label: "Open the case",
            example: isExample(ai),
          }
        : null,
      empty: { text: "No checked payments yet.", href: "/demo#s-gran-hi-mum", label: "Try the Hi Mum text" },
    },
    {
      id: "kernel",
      name: "Cloud browser",
      by: "KERNEL",
      does: "Opens a link or shop page in a throwaway browser in the cloud, so nobody in the family has to click it. It only looks: it never types, clicks or pays, and it's deleted after the visit.",
      example:
        kernel && page
          ? {
              text: `Opened ${host(page.finalUrl || page.url)} for ${what(kernel)}.`,
              href: caseLink(kernel),
              label: "See what it saw",
              example: isExample(kernel),
              shows,
              ...(page.screenshot && SHOT.test(page.screenshot) ? { thumb: { src: page.screenshot, alt: `What the cloud browser (KERNEL) saw on ${host(page.finalUrl || page.url)}` } } : {}),
              ...(peekableHost(kernel) ? { peek: { paymentId: kernel.id, host: peekableHost(kernel)! } } : {}),
            }
          : null,
      empty: { text: "No link or shop page opened for your family yet.", href: "/demo#s-agent-trap", label: "Try the booby trapped shop" },
    },
    {
      id: "channel3",
      name: "Real shop prices",
      by: "Channel3",
      does: "Prices the same product at real shops today, so a price far too high, or too cheap to be real, is caught. It also watches a price for you and finds the things in a photo.",
      example: priced
        ? {
            text: priced.market?.cheapest
              ? `${who(priced)} was asked ${money(priced.amount, priced.currency)} for ${cut(priced.market.item, 50)}. Real shops sell it from ${money(priced.market.cheapest.price, priced.market.cheapest.currency)}.`
              : `${what(priced)}: ${cut(priced.case_file!.spot!.headline, 80)}`,
            href: caseLink(priced),
            label: "See the prices",
            example: isExample(priced),
          }
        : null,
      empty: { text: "No product priced for your family yet.", href: "/demo#s-agent-big", label: "Try the £249 earbuds" },
    },
    {
      id: "watchtower",
      name: "Watchtower",
      by: "AG Studio",
      does: "The family's board: every payment, hold and scam sign in one place. Ask it a question and it builds the chart. It only reads, and never sees the scam messages.",
      example: {
        text: `Your board has ${n} payment${n === 1 ? "" : "s"}${extras.demo ? ", plus a sample month marked Sample" : ""}.`,
        href: "/watchtower",
        label: "Open Watchtower",
      },
      empty: { text: "", href: "/watchtower", label: "Open Watchtower" },
    },
    {
      id: "activity",
      name: "Activity",
      by: "AG Grid",
      does: "Every payment in one table you can sort and filter: who, how much, to whom, what happened, why, and PayPal's own id.",
      example: { text: `${n} payment${n === 1 ? "" : "s"} so far, each with its reasons and PayPal id.`, href: "/ledger", label: "Open Activity" },
      empty: { text: "", href: "/ledger", label: "Open Activity" },
    },
    {
      id: "paypal",
      name: "PayPal holds and webhooks",
      by: "PayPal",
      does: "Spotter asks PayPal to hold the money instead of taking it. Approve and PayPal pays it, deny and PayPal releases it. PayPal's signed webhooks confirm what really happened.",
      example: held
        ? {
            text: `${what(held)}: ${OUTCOME_WORDS[trackState(held.status)].long.toLowerCase()}.${event ? ` ${EVENT_WORDS[event.type] ?? "PayPal sent an update"}.` : ""}`,
            href: caseLink(held),
            label: "Open the case",
            example: isExample(held),
            evidence: `/api/payments/${held.id}/evidence`,
          }
        : null,
      empty: { text: "Nothing held at PayPal for your family yet.", href: "/demo#s-gran-hi-mum", label: "Try the Hi Mum text" },
    },
  ];
}
