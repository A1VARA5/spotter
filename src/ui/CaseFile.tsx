"use client";
// The case agent's write up on a held payment: what it most likely is, what each check found (every line names
// the check it came from), what to do before deciding, and a safer way to buy the same thing when there is one.
import { CircleAlert, Globe, Hand, Link2, ShoppingBag, Users } from "lucide-react";
import type { Case } from "@/agents/case";
import { money } from "./format";

const TOOL: Record<string, { label: string; Icon: typeof Users }> = {
  payee_history: { label: "Family history", Icon: Users },
  network_reports: { label: "Spotter network", Icon: CircleAlert },
  check_links: { label: "Links", Icon: Link2 },
  find_genuine_offer: { label: "Real shops", Icon: ShoppingBag },
  paypal_hold: { label: "PayPal", Icon: Hand },
  open_link: { label: "Opened safely", Icon: Globe },
};

// Only a JPEG data URL we made ourselves is ever put in an img src.
const SHOT = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

const VERDICT = { likely_scam: "Likely a scam", unclear: "Worth a closer look", looks_fine: "Looks genuine" } as const;

/** Still being built: only for a minute or two after the payment, after that there just isn't one. */
export function CasePending({ createdAt }: { createdAt: string }) {
  if (Date.now() - new Date(createdAt).getTime() > 2 * 60_000) return null;
  return (
    <p className="case-pending" role="status">
      <span className="case-spin" aria-hidden="true" />
      Spotter is looking into this: family history, other families, links and real prices.
    </p>
  );
}

export function CaseFile({
  c,
  currency,
  onSwap,
  busy,
  pageShot,
}: {
  c: Case;
  currency: string;
  onSwap?: () => void;
  busy?: boolean;
  /** Drawn in place of the page screenshot when there isn't a real one (the landing page's made up example). */
  pageShot?: React.ReactNode;
}) {
  return (
    <section className="case" data-verdict={c.verdict} aria-label="What Spotter found">
      <p className="case-verdict">{VERDICT[c.verdict]}</p>
      <p className="case-headline">{c.headline}</p>

      {c.findings.length > 0 && (
        <ul className="case-findings">
          {c.findings.map((f) => {
            const t = TOOL[f.tool] ?? { label: f.tool, Icon: CircleAlert };
            return (
              <li key={f.source + f.text}>
                <t.Icon size={17} strokeWidth={2} aria-hidden="true" />
                <span>
                  <b>{t.label}</b> {f.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {c.page && <OpenedPage page={c.page} shot={pageShot} />}

      {c.status !== "done" && (
        <p className="case-note">
          {c.status === "partial" ? "Some checks didn't finish, so this is only part of the picture." : "Spotter couldn't look into this one."}
        </p>
      )}

      {c.ask.length > 0 && (
        <div className="case-ask">
          <p className="case-ask-title">Before you decide</p>
          <ul>
            {c.ask.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {c.swap && onSwap && (
        <div className="case-swap">
          <p>
            <b>{c.swap.title}</b> is {money(c.swap.price, currency)} at {c.swap.domain}.{" "}
            <a href={c.swap.url} target="_blank" rel="noopener noreferrer nofollow">
              See it there
            </a>
          </p>
          <button className="btn btn-quiet" disabled={busy} onClick={onSwap}>
            {busy ? "Swapping" : `Deny this, buy it from ${c.swap.domain}`}
          </button>
        </div>
      )}
    </section>
  );
}

/** What Spotter saw when it opened the link in a throwaway cloud browser, so nobody in the family had to. */
function OpenedPage({ page, shot }: { page: NonNullable<Case["page"]>; shot?: React.ReactNode }) {
  const asks = [page.asks.card && "card details", page.asks.login && "a login", page.asks.giftCard && "a gift card code"].filter(Boolean) as string[];
  return (
    <figure className="case-page">
      {page.screenshot && SHOT.test(page.screenshot) ? (
        <img src={page.screenshot} alt={`What the link showed: ${page.title || host(page.finalUrl)}`} width={320} height={200} />
      ) : (
        shot
      )}
      <figcaption>
        <b>Opened safely</b> Spotter opened the link in a throwaway browser so nobody had to. It ended up at <b>{host(page.finalUrl)}</b>
        {asks.length ? (
          <>
            {" "}
            and asks for <b>{asks.join(", ")}</b>.
          </>
        ) : (
          "."
        )}
      </figcaption>
    </figure>
  );
}
