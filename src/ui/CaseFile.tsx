"use client";
// The case agent's write up on a held payment: what it most likely is, what each check found (every line names
// the check it came from), what to do before deciding, and a safer way to buy the same thing when there is one.
import { useState } from "react";
import { CircleAlert, Globe, Hand, Link2, Play, ScanEye, ShoppingBag, Users } from "lucide-react";
import type { Case } from "@/agents/case";
import { WHY_LABEL } from "@/agents/seen";
import { money } from "./format";
import { Peek } from "./Peek";

const TOOL: Record<string, { label: string; Icon: typeof Users }> = {
  payee_history: { label: "Family history", Icon: Users },
  network_reports: { label: "Spotter network", Icon: CircleAlert },
  check_links: { label: "Links", Icon: Link2 },
  find_genuine_offer: { label: "Real shops", Icon: ShoppingBag },
  paypal_hold: { label: "PayPal", Icon: Hand },
  open_link: { label: "Opened safely", Icon: Globe },
  inspect_shop: { label: "Shop page", Icon: ScanEye },
};

// KERNEL keeps a recording for about a day; after that the button would only lead to "expired".
const REPLAY_FOR_MS = 23 * 60 * 60 * 1000;

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
  paymentId,
  onSwap,
  busy,
  pageShot,
  footer,
}: {
  c: Case;
  currency: string;
  /** Needed to play KERNEL's recording of the page visit (/api/payments/[id]/replay). */
  paymentId?: string;
  onSwap?: () => void;
  busy?: boolean;
  /** A drawn stand in for the screenshot, for mock ups on the landing page. */
  pageShot?: React.ReactNode;
  /** Shown last, inside the case file: the price watch line on the dashboard. */
  footer?: React.ReactNode;
}) {
  return (
    <section className="case" data-verdict={c.verdict} aria-label="What Spotter found">
      <p className="case-verdict">
        {VERDICT[c.verdict]}
        {c.example && <span className="case-example"> · Example, checked earlier</span>}
      </p>
      <p className="case-headline">{c.headline}</p>

      {c.findings.length > 0 && (
        <ul className="case-findings">
          {c.findings.map((f) => {
            const t = TOOL[f.tool] ?? { label: f.tool, Icon: CircleAlert };
            return (
              <li key={f.source + f.text} data-severity={f.severity}>
                <t.Icon size={17} strokeWidth={2} aria-hidden="true" />
                <span>
                  <b>{t.label}</b> {f.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {c.page && <OpenedPage page={c.page} paymentId={paymentId} fallback={pageShot} />}

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
      {footer}
    </section>
  );
}

/**
 * What Spotter saw when it opened the page in a throwaway cloud browser (KERNEL), so nobody in the family had to.
 * When the page hides text from people that an AI agent reads, the two are shown side by side.
 */
function OpenedPage({ page, paymentId, fallback }: { page: NonNullable<Case["page"]>; paymentId?: string; fallback?: React.ReactNode }) {
  const [watching, setWatching] = useState(false);
  const [replayFailed, setReplayFailed] = useState(false);
  const asks = [page.asks.card && "card details", page.asks.login && "a login", page.asks.giftCard && "a gift card code"].filter(Boolean) as string[];
  const shot = page.screenshot && SHOT.test(page.screenshot) ? page.screenshot : undefined;
  const trap = page.seen?.hidden.find((h) => h.instruction);
  const replayAt = page.replay ? new Date(page.replay.at).getTime() : NaN;
  const canWatch = !!paymentId && Date.now() - replayAt < REPLAY_FOR_MS;

  const view = watching && !replayFailed ? (
    // Our own route relays KERNEL's video; the browser never gets KERNEL's link.
    <video className="case-page-video" src={`/api/payments/${encodeURIComponent(paymentId!)}/replay`} poster={shot} controls autoPlay muted playsInline width={320} height={240} onError={() => setReplayFailed(true)}>
      Your browser can&apos;t play the recording.
    </video>
  ) : shot ? (
    <img src={shot} alt={`What the page showed: ${page.title || host(page.finalUrl)}`} width={320} height={240} />
  ) : (
    (fallback ?? null)
  );

  const watch = replayFailed ? (
    <span className="case-note" role="status">
      {" "}
      The recording isn&apos;t available any more (they&apos;re kept for a day).
    </span>
  ) : (
    canWatch &&
    !watching && (
      <button type="button" className="case-watch" onClick={() => setWatching(true)}>
        <Play size={15} strokeWidth={2.2} aria-hidden="true" /> Watch Spotter open it
      </button>
    )
  );
  // Watch the recording, or look at the page live on a computer in the cloud (only on a real payment's case file).
  const actions = (watch || paymentId) && (
    <div className="case-actions">
      {watch}
      {paymentId && <Peek paymentId={paymentId} host={host(page.finalUrl)} />}
    </div>
  );
  // Said plainly, so a check that didn't run never reads as "nothing hidden".
  const unchecked = !page.seen ? (
    <> Spotter couldn&apos;t compare what a person sees with what an agent reads on this page.</>
  ) : !trap && (page.seen.truncated || !page.seen.isolated) ? (
    <> Only part of the page could be checked for hidden text.</>
  ) : null;

  const where = (
    <>
      Spotter opened <b>{host(page.finalUrl)}</b> in a throwaway cloud browser so nobody had to
      {asks.length ? (
        <>
          . It asks for <b>{asks.join(", ")}</b>.
        </>
      ) : (
        "."
      )}
    </>
  );

  if (trap && page.seen) {
    return (
      <figure className="case-seen" aria-label="What a person sees vs what your agent read">
        <p className="case-seen-title">What a person sees vs what your agent read</p>
        <div className="case-seen-grid">
          <div className="case-seen-side">
            <p className="case-seen-label">A person sees</p>
            {view ?? <p className="case-seen-sample">{page.seen.visibleSample || "No text."}</p>}
          </div>
          <div className="case-seen-side case-seen-hidden">
            <p className="case-seen-label">Your agent also read, hidden from people</p>
            <blockquote>
              <mark>{trap.text}</mark>
            </blockquote>
            <p className="case-seen-why">
              Hidden on the page: {WHY_LABEL[trap.why]}. A person can see {page.seen.visibleChars} of its {page.seen.domChars} characters of text.
            </p>
          </div>
        </div>
        <figcaption>
          {where} {actions}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="case-page">
      {view}
      <figcaption>
        {where}
        {unchecked} {actions}
      </figcaption>
    </figure>
  );
}
