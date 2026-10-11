"use client";
// The case agent's write up on a held payment: what it most likely is, what each check found (every line names
// the check it came from), what to do before deciding, and a safer way to buy the same thing when there is one.
import { useId, useState } from "react";
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
  peekScrolls,
}: {
  /** Scrolls the spotter made looking at the page safely; null or undefined when they never looked. */
  peekScrolls?: number | null;
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

      {c.page && <OpenedPage page={c.page} paymentId={paymentId} fallback={pageShot} inFaces={!!(c.page.faces?.compared && c.page.phone?.screenshot)} />}
      {c.page?.faces && <TwoFaces page={c.page} />}
      {c.page?.trail && <MoneyTrailPanel trail={c.page.trail} />}
      {c.page?.proof && <ProofCard proof={c.page.proof} peekScrolls={peekScrolls} />}
      {c.page?.tools?.checked && c.page.tools.total > 0 && <ShopToolList tools={c.page.tools} />}
      {c.page?.tools && !c.page.tools.checked && <p className="case-note">Spotter couldn&apos;t list the tools this shop offers AI agents.</p>}
      {c.spot && <SpotPanel spot={c.spot} shot={c.page?.screenshot} />}

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

type CasePageT = NonNullable<Case["page"]>;

const FACE_DIFF: Record<string, string> = {
  final_site: "Ends up on",
  asks_money: "Card or bank",
  asks_login: "Log in",
  asks_gift_card: "Gift card",
  text: "Words",
  title: "Title",
  look: "Colours",
};

/** The card or bank form, outlined on the screenshot it was found in. */
function Outline({ box }: { box?: CasePageT["moneyBox"] }) {
  if (!box || box.w <= 0 || box.h <= 0) return null;
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  return <span className="faces-box" style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }} aria-hidden="true" />;
}

/**
 * Two faces: the same link opened at the same moment as a desktop (how scanners see it) and as Gran's phone. The two
 * frames side by side with the card form outlined, a slider that blends one picture into the other, one verdict line,
 * then what differed. Said plainly when the phone wasn't on a UK network, and when the two couldn't be compared.
 */
function TwoFaces({ page }: { page: CasePageT }) {
  const titleId = useId();
  const sliderId = useId();
  const [mix, setMix] = useState(50);
  const faces = page.faces!;
  const desk = page.screenshot && SHOT.test(page.screenshot) ? page.screenshot : undefined;
  const phone = page.phone?.screenshot && SHOT.test(page.phone.screenshot) ? page.phone.screenshot : undefined;
  const uk = page.phone && page.phone.network !== "direct";
  const differs = faces.compared && faces.differs;
  return (
    <section className="faces" data-differs={differs ? "true" : undefined} aria-labelledby={titleId}>
      <p className="faces-title" id={titleId}>
        Two faces: what scanners see and what Gran&apos;s phone sees
      </p>
      <p className="faces-verdict">{faces.verdict}</p>
      {faces.compared && (
        <div className="faces-grid">
          <figure className="faces-side faces-desk">
            <div className="faces-frame">
              {desk ? <img src={desk} alt={`Desktop view of ${host(page.finalUrl)}`} width={320} height={240} /> : <div className="faces-blank" />}
              <Outline box={page.moneyBox} />
            </div>
            <figcaption>
              <b>Desktop</b>, the way security scanners see it
            </figcaption>
          </figure>
          <figure className="faces-side faces-phone">
            <div className="faces-frame">
              {phone ? <img src={phone} alt={`Phone view of ${host(page.phone?.finalUrl ?? page.finalUrl)}`} width={195} height={422} /> : <div className="faces-blank" />}
              <Outline box={page.phone?.moneyBox} />
            </div>
            <figcaption>
              <b>Gran&apos;s phone</b>, {uk ? "on a UK mobile network" : "set to UK English and time (not on a UK network)"}
            </figcaption>
          </figure>
        </div>
      )}
      {faces.compared && desk && phone && (
        <div className="faces-onion">
          <div className="faces-stage" aria-hidden="true">
            <img src={desk} alt="" className="faces-under" style={{ opacity: (100 - mix) / 100 }} />
            <img src={phone} alt="" className="faces-over" style={{ opacity: mix / 100 }} />
          </div>
          <label htmlFor={sliderId} className="faces-slider">
            <span>Desktop</span>
            <input id={sliderId} type="range" min={0} max={100} step={5} value={mix} onChange={(e) => setMix(Number(e.target.value))} aria-valuetext={`${100 - mix}% desktop, ${mix}% phone`} />
            <span>Phone</span>
          </label>
        </div>
      )}
      {faces.compared && faces.differences.length > 0 && (
        <ol className="spot-diffs faces-diffs">
          {faces.differences.map((d, i) => (
            <li key={d.kind} style={{ "--i": i } as React.CSSProperties}>
              <span className="spot-diff-label">{FACE_DIFF[d.kind] ?? d.kind}</span>
              <span>
                <span className="sr-only">Desktop: </span>
                {d.desktop}
              </span>
              <span className={d.strong ? "spot-diff-here" : undefined}>
                <span className="sr-only">Phone: </span>
                {d.phone}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const STEP = { link: "The link", redirect: "Sent on to", landed: "Landed on" } as const;

/** Where the page sends people and where its card form would send their details. Read from the page, never sent. */
function MoneyTrailPanel({ trail }: { trail: NonNullable<CasePageT["trail"]> }) {
  const titleId = useId();
  return (
    <section className="trail" data-offsite={trail.offsite ? "true" : undefined} aria-labelledby={titleId}>
      <p className="trail-title" id={titleId}>
        Where the money goes
      </p>
      {trail.line ? <p className="trail-line">{trail.line}</p> : <p className="case-tools-sub">The page has no card or bank form.</p>}
      {trail.steps.length > 0 && (
        <ol className="trail-steps">
          {trail.steps.map((s, i) => (
            <li key={`${s.host}-${i}`}>
              <span className="trail-how">{STEP[s.how]}</span> <b>{s.host}</b>
            </li>
          ))}
        </ol>
      )}
      <p className="spot-source">
        {trail.stepsFrom === "network log" ? "From the cloud browser's own log of every page it loaded." : "Only where it started and where it ended: the cloud browser's log wasn't available."} Nothing was typed or sent.
      </p>
    </section>
  );
}

/** "Proof Spotter never touched it": counts from KERNEL's own log. A count it didn't record says so, never zero. */
function ProofCard({ proof, peekScrolls }: { proof: NonNullable<CasePageT["proof"]>; peekScrolls?: number | null }) {
  const titleId = useId();
  const n = (v: number | null) => (v === null ? "Not recorded" : String(v));
  const rows: Array<[string, string, boolean]> = [
    ["Clicks", n(proof.clicks), proof.clicks === null],
    ["Keys typed", n(proof.keys), proof.keys === null],
    ["Scrolls by Spotter", n(proof.scrolls), proof.scrolls === null],
    ["Your scrolls looking at it", typeof peekScrolls === "number" ? String(peekScrolls) : "None", typeof peekScrolls !== "number"],
    ["Downloads", proof.downloadsBlocked === true ? "Blocked" : proof.downloadsBlocked === false ? "Not confirmed blocked" : "Not recorded", proof.downloadsBlocked !== true],
    ["Calls to the cloud browser", String(proof.apiCalls), false],
  ];
  return (
    <section className="proof" aria-labelledby={titleId}>
      <p className="proof-title" id={titleId}>
        Proof Spotter never touched it
      </p>
      <dl className="proof-grid">
        {rows.map(([k, v, unknown]) => (
          <div key={k} data-unknown={unknown ? "true" : undefined}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="spot-source">
        Counted by the cloud browser&apos;s own log of the visit
        {proof.deleted === true ? ", and the browser was deleted straight after." : proof.deleted === false ? ". Deleting the browser wasn't confirmed; it ends itself after 20 seconds idle." : "."}
      </p>
      {(proof.hashes.screenshot || proof.hashes.text) && (
        <details className="proof-hashes">
          <summary>Fingerprints of what Spotter kept</summary>
          <p className="case-tools-sub">SHA-256 of the screenshot and the page text, so anyone can check they weren&apos;t changed later.</p>
          {proof.hashes.screenshot && (
            <p>
              Screenshot <code>{proof.hashes.screenshot}</code>
            </p>
          )}
          {proof.hashes.text && (
            <p>
              Page text <code>{proof.hashes.text}</code>
            </p>
          )}
        </details>
      )}
    </section>
  );
}

// Only Channel3's own image host is ever put in an img src for the genuine listing.
const CDN = /^https:\/\/cdn\.trychannel3\.com\/[A-Za-z0-9._~%?=&/-]{1,300}$/;
const HTTPS = /^https:\/\/[^\s"<>]+$/;

/**
 * Spot the difference: the shop's screenshot next to the same product at a real shop (found by Channel3's image
 * search and checked to be the same product), one number first, one verdict line, then up to 3 differences.
 */
function SpotPanel({ spot, shot }: { spot: NonNullable<Case["spot"]>; shot?: string }) {
  const titleId = useId();
  const here = shot && SHOT.test(shot) ? shot : undefined;
  const real = spot.genuine.image && CDN.test(spot.genuine.image) ? spot.genuine.image : undefined;
  return (
    <section className="spot" data-direction={spot.direction} aria-labelledby={titleId}>
      <p className="spot-title" id={titleId}>
        Spot the difference
      </p>
      <p className="spot-number">{spot.headline}</p>
      <p className="spot-verdict">{spot.verdict}</p>
      <div className="spot-grid">
        <figure className="spot-side spot-here">
          {here ? <img src={here} alt={`The shop Spotter opened: ${spot.here.host}`} width={320} height={240} /> : <div className="spot-blank" aria-hidden="true" />}
          <figcaption>
            <b>This shop</b> {spot.here.host} · {money(spot.here.price, spot.currency)}
          </figcaption>
        </figure>
        <figure className="spot-side spot-real">
          {real ? <img src={real} alt={spot.genuine.title} width={320} height={240} loading="lazy" referrerPolicy="no-referrer" /> : <div className="spot-blank" aria-hidden="true" />}
          <figcaption>
            <b>{spot.genuine.title}</b> {money(spot.genuine.price, spot.currency)} at {spot.genuine.domain}
            {HTTPS.test(spot.genuine.url) && (
              <>
                {" "}
                <a href={spot.genuine.url} target="_blank" rel="noopener noreferrer nofollow">
                  See it there
                </a>
              </>
            )}
          </figcaption>
        </figure>
      </div>
      {spot.differences.length > 0 && (
        <ol className="spot-diffs">
          {spot.differences.map((d, i) => (
            <li key={d.label} style={{ "--i": i } as React.CSSProperties}>
              <span className="spot-diff-label">{d.label}</span>
              <span className="spot-diff-here">
                <span className="sr-only">This shop: </span>
                {d.here}
              </span>
              <span className="spot-diff-real">
                <span className="sr-only">Real shops: </span>
                {d.real}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="spot-source">Found by searching real shops with a picture of this page. Prices and shop names come from those shops&apos; listings.</p>
    </section>
  );
}

/**
 * The tools the shop offers AI agents (WebMCP), as plain words, never raw JSON. A line written to steer the agent is
 * shown in red with the tool's name and where it sits. Spotter only listed these; it never ran one.
 */
function ShopToolList({ tools }: { tools: Extract<NonNullable<NonNullable<Case["page"]>["tools"]>, { checked: true }> }) {
  const more = tools.total - tools.tools.length;
  const titleId = useId();
  return (
    <section className="case-tools" aria-labelledby={titleId}>
      <p className="case-tools-title" id={titleId}>
        Tools this shop offers AI agents
      </p>
      <p className="case-tools-sub">An AI agent reads these to decide what to do. Spotter only listed them and never ran one.</p>
      <ul>
        {tools.tools.map((t, i) => (
          <li key={`${t.name}-${i}`} className="case-tool" data-poisoned={t.poisoned ? "true" : undefined}>
            <p className="case-tool-head">
              <code>{t.name}</code>
              {t.poisoned && <span className="case-tool-tag">Written to steer your agent</span>}
              {!t.poisoned && t.hints[0] && <span className="case-tool-hint">{t.hints[0]}</span>}
            </p>
            {t.description && <p className="case-tool-desc">{t.description}</p>}
            {t.frame && <p className="case-tool-desc">Offered by an embedded page from {t.frame}.</p>}
            {t.poisoned && (
              <>
                <p className="case-tool-where">In {t.poisoned.where}:</p>
                <blockquote>
                  <mark>{t.poisoned.quote}</mark>
                </blockquote>
              </>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="case-tools-sub">And {more} more.</p>}
      {tools.incomplete && <p className="case-tools-sub">Spotter couldn&apos;t read all of this shop&apos;s tools, so this is only part of the picture.</p>}
    </section>
  );
}

/**
 * What Spotter saw when it opened the page in a throwaway cloud browser (KERNEL), so nobody in the family had to.
 * When the page hides text from people that an AI agent reads, the two are shown side by side.
 */
function OpenedPage({ page, paymentId, fallback, inFaces }: { page: NonNullable<Case["page"]>; paymentId?: string; fallback?: React.ReactNode; /** The screenshot is shown in the two faces panel instead. */ inFaces?: boolean }) {
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
  ) : shot && !inFaces ? (
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
