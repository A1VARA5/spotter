"use client";
// The case agent's write up on a held payment: what it most likely is, what each check found (every line names
// the check it came from), what to do before deciding, and a safer way to buy the same thing when there is one.
import { Fragment, useEffect, useId, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, CircleAlert, ExternalLink, Globe, Hand, Link2, Play, ScanEye, ShoppingBag, Users } from "lucide-react";
import type { Case } from "@/agents/case";
import { WHY_LABEL } from "@/agents/seen";
import { money } from "./format";
import { Hint } from "./Hint";
import { Peek } from "./Peek";
import { keyFacts, kernelLead, type RealOne } from "./caseFold";

const TOOL: Record<string, { label: string; Icon: typeof Users }> = {
  payee_history: { label: "Family history", Icon: Users },
  network_reports: { label: "Spotter network", Icon: CircleAlert },
  check_links: { label: "Links", Icon: Link2 },
  find_genuine_offer: {
    label: "Real shop prices (Channel3)",
    Icon: ShoppingBag,
  },
  paypal_hold: { label: "PayPal hold", Icon: Hand },
  open_link: { label: "Cloud browser (KERNEL)", Icon: Globe },
  inspect_shop: { label: "Cloud browser (KERNEL)", Icon: ScanEye },
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

/** Spotter's own made up demo pages (src/app/demo-shop), so a judge isn't left wondering why a scam lives on our site. */
const demoPage = (u: string) => {
  try {
    return new URL(u).pathname.startsWith("/demo-shop/");
  } catch {
    return false;
  }
};

const VERDICT = {
  likely_scam: "Likely a scam",
  unclear: "Worth a closer look",
  looks_fine: "Looks genuine",
} as const;

/**
 * The browser's clock, but only after the first render: null on the server and during hydration, so nothing drawn
 * from it can differ from the server's HTML. Used when the caller didn't pass the server's clock down.
 */
function useClientNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    // Ticks slowly, so a page left open stops offering a recording once it has expired.
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Still being built: only for a minute or two after the payment, after that there just isn't one. now is the
 * dashboard's clock (the server's on the first render), so the server HTML and the first client render agree.
 */
export function CasePending({ createdAt, now }: { createdAt: string; now: number }) {
  if (now - new Date(createdAt).getTime() > 2 * 60_000) return null;
  return (
    <p className="case-pending" role="status">
      <span className="case-spin" aria-hidden="true" />
      Spotter is looking into this: family history, other families, links and real prices.
    </p>
  );
}

type Shown = { f: Case["findings"][number]; id: string };

function FindingList({ items, id, label }: { items: Shown[]; id?: string; label: string }) {
  if (!items.length) return null;
  return (
    <ul className="case-findings" id={id} tabIndex={id ? -1 : undefined} aria-label={label}>
      {items.map(({ f, id: fid }) => {
        const t = TOOL[f.tool] ?? { label: "Check", Icon: CircleAlert };
        return (
          <li key={f.source + f.text} id={fid} tabIndex={-1} data-severity={f.severity}>
            <t.Icon size={17} strokeWidth={2} aria-hidden="true" />
            <span>
              <b>{t.label}</b> {plainWords(f.text)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A genuine listing from Channel3, opened on the shop's own site. Nothing is bought through Spotter here. */
function RealOneCard({ real, currency }: { real: RealOne; currency: string }) {
  return (
    <div className="cf-real">
      <p className="cf-real-label">Buy it from a real shop instead</p>
      <p className="cf-real-title">{real.title}</p>
      <p className="cf-real-price">
        <b className="num">{money(real.price, currency)}</b> at {real.domain}
      </p>
      <a className="btn btn-quiet cf-real-go" href={real.url} target="_blank" rel="noopener noreferrer nofollow">
        <span>Open {real.domain}</span>
        <ExternalLink size={15} strokeWidth={2.2} aria-hidden="true" />
        <span className="sr-only"> ({real.domain}&apos;s own page, opens in a new tab)</span>
      </a>
      <p className="cf-real-note">The shop&apos;s own page, found by Channel3. Nothing is bought unless you buy it there.</p>
    </div>
  );
}

export function CaseFile({
  c,
  currency,
  paymentId,
  onSwap,
  busy,
  pageShot,
  aside,
  peekScrolls,
  now,
  fold = false,
  settled = false,
  actions,
  more,
  moreCount = 0,
  real,
}: {
  /** The dashboard's clock (the server's on the first render). Without it, the replay button waits for the browser. */
  now?: number;
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
  /** Beside the three facts: the price watch on the dashboard. */
  aside?: React.ReactNode;
  /** Verdict, headline, three facts and the actions first, everything else behind "See the evidence (N)". */
  fold?: boolean;
  /** The payment was decided (paid, denied, released): past tense, and no advice about deciding. */
  settled?: boolean;
  /** The decision buttons, shown right after the three facts. */
  actions?: React.ReactNode;
  /** The caller's own evidence, last inside the fold (hold clock, the message), and how many items it holds. */
  more?: React.ReactNode;
  moreCount?: number;
  /** A genuine listing (Channel3) to open instead. */
  real?: RealOne | null;
}) {
  const clientNow = useClientNow();
  const clock = now ?? clientNow;
  const base = `cf-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [open, setOpen] = useState(false);
  const lead = kernelLead(c.page);
  const shown: Shown[] = c.findings.map((f, i) => ({ f, id: `${base}-f${i}` })).filter(({ f }) => !panelShows(f, c.page));
  const { facts: factList, rest: restList } = keyFacts(shown.map((s) => s.f));
  const byFinding = new Map(shown.map((s) => [s.f, s]));
  const facts = factList.map((f) => byFinding.get(f)!);
  const rest = restList.map((f) => byFinding.get(f)!);
  const ids = {
    head: `${base}-head`,
    findings: `${base}-findings`,
    kernel: `${base}-kernel`,
    spot: `${base}-spot`,
    swap: `${base}-swap`,
    fold: `${base}-fold`,
  };
  const showSwap = !settled && !!(c.swap && onSwap);
  const chips = checksThatRan(c, shown, ids, showSwap);
  const page = c.page;
  const inFaces = !!(page?.faces?.compared && page.phone?.screenshot);
  const toolsShown = !!(page?.tools?.checked && page.tools.total > 0);

  const panel = {
    page: page && <OpenedPage id={ids.kernel} page={page} paymentId={paymentId} now={clock} fallback={pageShot} inFaces={inFaces} />,
    tools: toolsShown && page?.tools?.checked && <ShopToolList tools={page.tools} />,
    faces: page?.faces && <TwoFaces page={page} compact={fold && lead?.kind === "faces"} />,
    trail: page?.trail && <MoneyTrailPanel trail={page.trail} />,
  };
  // The KERNEL catch shown open: the page panel holds the hidden text, the others their own panel.
  const leadKey = lead ? (lead.kind === "seen" ? "page" : lead.kind) : null;
  const panels = (["page", "tools", "faces", "trail"] as const).filter((k) => panel[k] && (!fold || k !== leadKey));
  const evidenceCount = rest.length + panels.length + (c.spot ? 1 : 0) + (page?.proof ? 1 : 0) + moreCount;
  const ask = !settled && c.ask.length > 0;
  const hasFold = rest.length > 0 || ask || showSwap || panels.length > 0 || !!c.spot || !!page?.proof || !!more;
  const isOpen = !fold || open;

  // A "Checked by" chip whose finding is folded away opens the fold first, then scrolls to it.
  const reveal = (id: string) => {
    const el = document.getElementById(id);
    if (el?.closest("[hidden]")) flushSync(() => setOpen(true));
    return document.getElementById(id);
  };

  return (
    <section className="case cf" data-verdict={c.verdict} data-fold={fold || undefined} aria-label="What Spotter found">
      <div className="cf-top">
        <p className="case-verdict">
          {VERDICT[c.verdict]}
          {c.example && <span className="case-example"> · Example, checked earlier</span>}
        </p>
        <p className="case-headline" id={ids.head} tabIndex={-1}>
          {c.headline}
        </p>
        {chips.length > 0 && <CheckedBy chips={chips} reveal={reveal} />}
      </div>

      {(facts.length > 0 || real || aside || c.status !== "done") && (
        <div className="cf-first" data-aside={real || aside ? "true" : undefined}>
          <div className="cf-facts">
            {settled && facts.length > 0 && <p className="cf-sub">What Spotter saw</p>}
            <FindingList items={facts} id={ids.findings} label={settled ? "What Spotter saw" : "What each check found"} />
            {c.status !== "done" && (
              <p className="case-note">
                {c.aiDown
                  ? c.status === "partial"
                    ? "Only Spotter's own checks ran (no AI read this one), so this is only part of the picture."
                    : "No AI could read this one and Spotter's own checks couldn't run either, so decide from what you know."
                  : c.status === "partial"
                    ? "Some checks didn't finish, so this is only part of the picture."
                    : "Spotter couldn't look into this one."}
              </p>
            )}
          </div>
          {(real || aside) && (
            <div className="cf-aside">
              {real && <RealOneCard real={real} currency={currency} />}
              {aside}
            </div>
          )}
        </div>
      )}

      {actions}

      {fold && lead && leadKey && panel[leadKey] && (
        <div className="cf-lead" data-kind={lead.kind}>
          <p className="cf-lead-line">
            <b>KERNEL</b>
            {lead.line.slice("KERNEL".length)}
          </p>
          {panel[leadKey]}
        </div>
      )}

      {fold && hasFold && (
        <button type="button" className="cf-more" aria-expanded={open} aria-controls={ids.fold} onClick={() => setOpen((v) => !v)}>
          <span>{open ? "Hide the evidence" : `${lead ? "See more evidence" : "See the evidence"} (${evidenceCount})`}</span>
          <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}

      {hasFold && (
        <div className="cf-fold" id={ids.fold} hidden={!isOpen}>
          <div className="cf-fold-text">
            <FindingList items={rest} label="More of what each check found" />
            {ask && (
              <div className="case-ask">
                <p className="case-ask-title">Before you decide</p>
                <ul>
                  {c.ask.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {showSwap && c.swap && (
              <div className="case-swap" id={ids.swap} tabIndex={-1}>
                <p>
                  Or let Spotter swap it: deny this and pay <b>{money(c.swap.price, currency)}</b> to {c.swap.domain} for {c.swap.title} through PayPal instead.
                </p>
                <button className="btn btn-quiet" disabled={busy} onClick={onSwap}>
                  {busy ? "Swapping" : `Deny this, buy it from ${c.swap.domain}`}
                </button>
              </div>
            )}
            {more}
          </div>
          {(panels.length > 0 || c.spot || page?.proof || page?.tools) && (
            <div className="cf-panels">
              {panels.map((k) => (
                <Fragment key={k}>{panel[k]}</Fragment>
              ))}
              {page?.tools && !page.tools.checked && <p className="case-note">Spotter couldn&apos;t list the tools this shop offers AI agents.</p>}
              {c.spot && <SpotPanel id={ids.spot} spot={c.spot} shot={page?.screenshot} />}
              {page?.proof && <ProofCard proof={page.proof} peekScrolls={peekScrolls} />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type Chip = { key: string; label: string; target?: string };

/**
 * True when one of the evidence panels already shows this code made finding (two faces, the money trail, the hidden
 * line, a poisoned tool), so the list doesn't say it a second time. The finding still goes to alerts and the pack.
 */
function panelShows(f: Case["findings"][number], page: Case["page"]): boolean {
  if (!page || !f.kind) return false;
  if (f.kind === "cloaking") return !!page.faces;
  if (f.kind === "money_offsite") return !!page.trail;
  if (f.toolName) return !!(page.tools?.checked && page.tools.total > 0 && page.tools.tools.some((t) => t.name === f.toolName));
  return !!(page.seen && page.seen.hidden.some((h) => h.instruction));
}

/** Only the checks that really ran, each pointing at what it found (a finding or a panel). */
function checksThatRan(
  c: Case,
  shown: Array<{ f: Case["findings"][number]; id: string }>,
  ids: {
    head: string;
    findings: string;
    kernel: string;
    spot: string;
    swap: string;
  },
  swapShown: boolean,
): Chip[] {
  const ran = (tool: string) => c.calls.some((x) => x.tool === tool && x.ok) || c.findings.some((f) => f.tool === tool);
  const first = (tool: string) => shown.find(({ f }) => f.tool === tool)?.id;
  const chips: Chip[] = [];
  if (c.status !== "failed")
    chips.push({
      key: "ai",
      label: "Spotter's AI check",
      target: shown.length ? ids.findings : ids.head,
    });
  if (c.page)
    chips.push({
      key: "kernel",
      label: "Cloud browser (KERNEL)",
      target: ids.kernel,
    });
  if (ran("find_genuine_offer") || c.spot || swapShown) {
    chips.push({
      key: "channel3",
      label: "Real shop prices (Channel3)",
      target: first("find_genuine_offer") ?? (c.spot ? ids.spot : swapShown ? ids.swap : undefined),
    });
  }
  if (ran("paypal_hold"))
    chips.push({
      key: "paypal",
      label: "PayPal hold",
      target: first("paypal_hold"),
    });
  if (ran("network_reports"))
    chips.push({
      key: "network",
      label: "Spotter network",
      target: first("network_reports"),
    });
  return chips;
}

function CheckedBy({ chips, reveal }: { chips: Chip[]; reveal: (id: string) => HTMLElement | null }) {
  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = reveal(id);
    if (!el) return;
    e.preventDefault();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  };
  return (
    <nav className="cf-checked" aria-label="Checked by">
      <span className="cf-checked-label" aria-hidden="true">
        Checked by
      </span>
      <ul>
        {chips.map((ch) => (
          <li key={ch.key}>
            {ch.target ? (
              <a className="cf-chip" href={`#${ch.target}`} onClick={(e) => jump(e, ch.target!)}>
                {ch.label}
              </a>
            ) : (
              <span className="cf-chip" data-quiet="true">
                {ch.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A panel's title, the engine that did the work in plain words, and a (?) that explains it. */
function PanelHead({ id, title, engine, children }: { id: string; title: string; engine: string; children: React.ReactNode }) {
  return (
    <div className="cf-head">
      <p className="cf-title" id={id}>
        {title}
      </p>
      <p className="cf-engine">{engine}</p>
      <Hint q={`About this: ${title}`} iconOnly className="cf-hint">
        {children}
      </Hint>
    </div>
  );
}

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const RAW_HOLD: Record<string, string> = {
  CREATED: "holding the money, nothing has moved yet",
  PENDING: "still being set up",
  VOIDED: "cancelled, nothing was paid",
  EXPIRED: "over, nothing was paid",
  CAPTURED: "paid",
};

/** Older case files quoted PayPal's raw status and ISO dates; they read in plain words here. */
function plainWords(text: string): string {
  return text
    .replace(/PayPal hold [A-Z0-9]{6,} is (CREATED|PENDING|VOIDED|EXPIRED|CAPTURED)\b/g, (_, s: string) => `The PayPal hold is ${RAW_HOLD[s]}`)
    .replace(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, (m, y: string, mo: string, d: string) => (MONTH[Number(mo) - 1] ? `${Number(d)} ${MONTH[Number(mo) - 1]} ${y}` : m));
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
  return (
    <span
      className="faces-box"
      style={{
        left: pct(box.x),
        top: pct(box.y),
        width: pct(box.w),
        height: pct(box.h),
      }}
      aria-hidden="true"
    />
  );
}

/**
 * Two faces: the same link opened at the same moment as a desktop (how scanners see it) and as Gran's phone. The two
 * frames side by side with the card form outlined, a slider that blends one picture into the other, one verdict line,
 * then what differed. Said plainly when the phone wasn't on a UK network, and when the two couldn't be compared.
 */
function TwoFaces({ page, compact = false }: { page: CasePageT; compact?: boolean }) {
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
      <PanelHead id={titleId} title="Two faces" engine="Two KERNEL browsers, same moment">
        <p>
          Some scam pages show security scanners a harmless page and only show phones the card form. Spotter opens the link twice at the same moment in KERNEL&apos;s cloud browsers, once as a desktop
          and once as a phone, and compares what each was shown.
        </p>
        <p>It can&apos;t see what a page shows to one person only, at another time.</p>
      </PanelHead>
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
              <b>A phone</b>, {uk ? `on a UK ${page.phone?.network === "uk_residential" ? "home" : "mobile"} network` : "set to UK English and time (not on a UK network)"}
            </figcaption>
          </figure>
        </div>
      )}
      {!compact && faces.compared && desk && phone && (
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

const STEP = {
  link: "The link",
  redirect: "Sent on to",
  landed: "Landed on",
} as const;

/** Where the page sends people and where its card form would send their details. Read from the page, never sent. */
function MoneyTrailPanel({ trail }: { trail: NonNullable<CasePageT["trail"]> }) {
  const titleId = useId();
  return (
    <section className="trail" data-offsite={trail.offsite ? "true" : undefined} aria-labelledby={titleId}>
      <PanelHead id={titleId} title="Where the money goes" engine="KERNEL's log of every page loaded">
        <p>
          The cloud browser keeps its own log of every page it loaded. Spotter reads it to show where the link really sends people, and reads the card form to see where details typed into it would go.
        </p>
        <p>Nothing is typed or sent, so it can&apos;t see what happens after someone presses pay.</p>
      </PanelHead>
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
        {trail.stepsFrom === "network log" ? "From the cloud browser's own log of every page it loaded." : "Only where it started and where it ended: the cloud browser's log wasn't available."}{" "}
        Nothing was typed or sent.
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
    ["Scrolls you asked for looking at it", typeof peekScrolls === "number" ? String(peekScrolls) : peekScrolls === null ? "None" : "Not recorded", typeof peekScrolls !== "number"],
    ["Downloads", proof.downloadsBlocked === true ? "Blocked" : proof.downloadsBlocked === false ? "Not confirmed blocked" : "Not recorded", proof.downloadsBlocked !== true],
    ["Calls to the cloud browser", String(proof.apiCalls), false],
  ];
  return (
    <section className="proof" aria-labelledby={titleId}>
      <PanelHead id={titleId} title="Proof Spotter never touched it" engine="Counted from KERNEL's own log">
        <p>These numbers come from the cloud browser&apos;s own record of the visit, not from Spotter&apos;s word: every click, key and scroll it saw, and every call Spotter made to it.</p>
        <p>A count it didn&apos;t record says Not recorded, never zero. The fingerprints let anyone check later that the screenshot and page text weren&apos;t changed.</p>
      </PanelHead>
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
function SpotPanel({ id, spot, shot }: { id: string; spot: NonNullable<Case["spot"]>; shot?: string }) {
  const titleId = useId();
  const here = shot && SHOT.test(shot) ? shot : undefined;
  // A picture that fails to load (blocked, gone) falls back to the listing's own words, never an empty box.
  const [imageFailed, setImageFailed] = useState(false);
  const real = !imageFailed && spot.genuine.image && CDN.test(spot.genuine.image) ? spot.genuine.image : undefined;
  const fromMarket = spot.source === "market";
  return (
    <section className="spot" id={id} tabIndex={-1} data-direction={spot.direction} aria-labelledby={titleId}>
      <PanelHead id={titleId} title="Spot the difference" engine={fromMarket ? "Real shop prices (Channel3)" : "Real shop prices (Channel3), image search"}>
        {fromMarket ? (
          <p>The same real shop listings as Spotter&apos;s price check on this payment, so every price on this card agrees. Shops in other countries are left out.</p>
        ) : (
          <p>Spotter searched real shops with a picture of this page and kept a match only when it is the same product. Prices and shop names come from those shops&apos; own listings.</p>
        )}
        <p>A shop that sells it but isn&apos;t listed won&apos;t show up here.</p>
      </PanelHead>
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
          {real ? (
            <img src={real} alt={spot.genuine.title} width={320} height={240} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          ) : (
            <div className="spot-listing" aria-hidden="true">
              <span className="spot-listing-title">{spot.genuine.title}</span>
              <span className="spot-listing-price">{money(spot.genuine.price, spot.currency)}</span>
              <span className="spot-listing-shop">{spot.genuine.domain}</span>
            </div>
          )}
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
      <p className="spot-source">
        {fromMarket
          ? `The same ${spot.offers} real shop${spot.offers === 1 ? "" : "s"} as the price check on this payment. Prices and shop names come from those shops' listings.`
          : "Found by searching real shops with a picture of this page. Prices and shop names come from those shops' listings."}
      </p>
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
      <PanelHead id={titleId} title="Tools this shop offers AI agents" engine="Read from the page by KERNEL">
        <p>
          Shops can offer AI agents tools to call, like add to basket. An agent reads each tool&apos;s words to decide what to do, so a line in there written to steer the agent is a trick called tool
          poisoning.
        </p>
        <p>Spotter only listed the tools in the cloud browser. It never ran one.</p>
      </PanelHead>
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
function OpenedPage({
  id,
  page,
  paymentId,
  fallback,
  inFaces,
  now,
}: {
  id: string;
  /** null until there is a clock that can't differ from the server's HTML: no replay button until then. */
  now: number | null;
  page: NonNullable<Case["page"]>;
  paymentId?: string;
  fallback?: React.ReactNode;
  /** The screenshot is shown in the two faces panel instead. */
  inFaces?: boolean;
}) {
  const titleId = useId();
  const [watching, setWatching] = useState(false);
  const [replayFailed, setReplayFailed] = useState(false);
  const asks = [page.asks.card && "card details", page.asks.login && "a login", page.asks.giftCard && "a gift card code"].filter(Boolean) as string[];
  const shot = page.screenshot && SHOT.test(page.screenshot) ? page.screenshot : undefined;
  const trap = page.seen?.hidden.find((h) => h.instruction);
  const replayAt = page.replay ? new Date(page.replay.at).getTime() : NaN;
  const canWatch = !!paymentId && now !== null && now - replayAt < REPLAY_FOR_MS;

  const view =
    watching && !replayFailed ? (
      // Our own route relays KERNEL's video; the browser never gets KERNEL's link.
      <video
        className="case-page-video"
        src={`/api/payments/${encodeURIComponent(paymentId!)}/replay`}
        poster={shot}
        controls
        autoPlay
        muted
        playsInline
        width={320}
        height={240}
        onError={() => setReplayFailed(true)}
      >
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
      {demoPage(page.finalUrl) && <> This is a made up demo page hosted on Spotter&apos;s own site. Real scam sites are usually only days old.</>}
    </>
  );
  const about = (
    <>
      <p>KERNEL runs a throwaway browser on a computer in the cloud. Spotter opens the link there so nobody in the family has to, then deletes it.</p>
      <p>It only looks: it never types, clicks, logs in or buys.</p>
    </>
  );

  if (trap && page.seen) {
    return (
      <figure className="case-seen" id={id} tabIndex={-1} aria-labelledby={titleId}>
        <PanelHead id={titleId} title="What a person sees vs what your agent read" engine="Cloud browser (KERNEL)">
          <p>
            Spotter opened the shop in KERNEL&apos;s cloud browser and compared the text a person can see with everything an AI agent reads on the page. Text hidden from people but written to give an
            agent orders is a trick called prompt injection.
          </p>
          <p>It only looks: it never types, clicks or buys.</p>
        </PanelHead>
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
    <figure className="case-page" id={id} tabIndex={-1} aria-labelledby={titleId}>
      <PanelHead id={titleId} title="The page, opened safely" engine="Cloud browser (KERNEL)">
        {about}
      </PanelHead>
      {view}
      <figcaption>
        {where}
        {unchecked} {actions}
      </figcaption>
    </figure>
  );
}
