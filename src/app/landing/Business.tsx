// "Runs a business? Same Spotter": the one landing section for small businesses. Families stay the story;
// this shows the same held card, with a supplier invoice in it.
import { Info } from "lucide-react";
import { Evidence, HoldTrack } from "@/ui/components";
import { CHANGED_BANK_ADVICE } from "@/core/decide";
import type { Flag } from "@/core/grounding";

const INVOICE =
  "Hello, please find invoice HP-4471 for 12 cases of takeaway boxes. Please note our bank details have changed, so pay the new account below by bank transfer. Pay today or we stop deliveries tomorrow.";
const FLAGS: Flag[] = [
  { kind: "changed_bank_details", severity: "high", quote: "our bank details have changed", why: "Fake supplier invoices swap the bank details." },
  { kind: "pressure", severity: "medium", quote: "Pay today or we stop deliveries tomorrow", why: "Rushing you so you don't check." },
];

export function Business({ href, cta }: { href: string; cta: string }) {
  return (
    <section className="shell biz-sec" aria-labelledby="biz-title">
      <div className="biz-copy">
        <h2 id="biz-title" className="sec-title reveal">
          Runs a business? Same Spotter
        </h2>
        <p className="sec-lede reveal">
          Swap Gran for whoever pays your suppliers, and the shopping agent for one that reorders stock. When an invoice turns up
          with new bank details, the bank transfer never goes out: you ring the supplier on a number you already have, then pay
          through PayPal.
        </p>
        <a className="btn btn-quiet biz-cta" href={href}>
          {cta}
        </a>
      </div>
      <article className="held biz-card" aria-label="Example: a supplier invoice held by Spotter">
        <div className="held-head">
          <div>
            <p className="held-amount num">£286.40</p>
            <p className="held-who">Tom to Harbourline Packaging, just now</p>
          </div>
        </div>
        <HoldTrack state="held" from="Tom" to="Harbourline" amount={28640} currency="GBP" />
        <ul className="reasons">
          <li className="reason">
            <Info className="reason-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{CHANGED_BANK_ADVICE}</span>
          </li>
        </ul>
        <Evidence text={INVOICE} flags={FLAGS} />
      </article>
    </section>
  );
}
