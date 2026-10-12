"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { HoldTrack } from "@/ui/components";
import { trackState } from "@/ui/format";
import { sponsorsOf, tryLayout, type Scenario } from "@/ui/scenarios";
import { labelsFor, OUTCOME_WORDS, type Labels } from "@/ui/labels";
import type { HouseholdKind } from "@/core/households";
import type { Payment } from "@/core/lifecycle";
import { plainError, readJson } from "@/ui/http";
import { Confirm } from "@/ui/Confirm";
import { OpenedPage } from "@/ui/CaseFile";
import { topReason } from "@/core/reasons";
import { caseStillComing, seenPage } from "./inline";
import "./demo.css";

export type SpenderLite = { id: string; name: string; kind: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Try a payment: the featured four first (families), then every other scenario exactly once, behind one
 * "More scenarios" disclosure. A business has no featured row, so its own two are shown openly.
 */
export function Demo({ spenders, kind = "family" }: { spenders: SpenderLite[]; kind?: HouseholdKind }) {
  const labels = labelsFor(kind);
  const { featured, more, extra } = tryLayout(kind);
  const [round, setRound] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const spenderFor = (s: Scenario) => spenders.find((p) => p.kind === s.spender);

  async function reset() {
    setResetting(true);
    try {
      const r = await fetch("/api/demo/reset", { method: "POST" });
      if (r.status === 401) {
        setNote("Unlock with your PIN on the dashboard first.");
        return;
      }
      if (!r.ok) throw new Error();
      const { cleared } = await readJson(r);
      setNote(cleared ? `Cleared ${cleared} payments. Allowances are full again.` : "Already fresh.");
      setRound((n) => n + 1);
      router.refresh();
    } catch {
      setNote("Couldn't reset. Try again in a moment.");
    } finally {
      setResetting(false);
    }
  }

  const inMore = featured.length > 0;
  // One group per person, in the order the scenarios list them (families: agent, Gran, Leo; a business: staff first).
  const groups = [...new Set(more.map((s) => s.spender))].map((who) => {
    const spender = spenders.find((p) => p.kind === who);
    const name = spender?.name ?? cap(labels.addWho[who]);
    const list = more.filter((s) => s.spender === who);
    return (
      <section key={who} className="scen-group" aria-label={name}>
        {inMore ? <h3 className="section-title scen-sub">{name}</h3> : <h2 className="section-title">{name}</h2>}
        <div className="scenarios">
          {list.map((s) => (
            <ScenarioCard key={s.id} s={s} spender={spender} labels={labels} level={inMore ? "h4" : "h3"} />
          ))}
        </div>
      </section>
    );
  });
  const business = extra.length > 0 && (
    <section className="scen-group scen-business" aria-labelledby="scen-business">
      <h3 id="scen-business" className="section-title scen-sub">
        Runs a business?
      </h3>
      <p className="scen-group-note">
        Same Spotter, different people: staff paying suppliers and AI buying agents ordering stock. Here{" "}
        {spenders.find((p) => p.kind === "person")?.name ?? "your relative"} forwards the invoice and{" "}
        the {spenders.find((p) => p.kind === "agent")?.name.toLowerCase() ?? "agent"} places the order.
      </p>
      <div className="scenarios">
        {extra.map((s) => (
          <ScenarioCard key={s.id} s={s} spender={spenderFor(s)} labels={labels} level="h4" />
        ))}
      </div>
    </section>
  );
  const count = more.length + extra.length;

  return (
    <div key={round}>
      {inMore && (
        <section className="scen-group scen-featured" aria-labelledby="featured-title">
          <h2 id="featured-title" className="section-title">
            Short on time? Start with these four
          </h2>
          <div className="scenarios">
            {featured.map(({ s, short }) => (
              <ScenarioCard key={s.id} s={s} short={short} spender={spenderFor(s)} labels={labels} level="h3" />
            ))}
          </div>
        </section>
      )}
      <div className="demo-bar">
        <Confirm
          trigger={resetting ? "Clearing" : "Start fresh"}
          disabled={resetting}
          title="Start fresh?"
          body="This clears every payment in this family, so allowances are full again. Holds already at PayPal simply expire. It can't be undone."
          confirmLabel="Clear payments"
          onConfirm={reset}
        />
        <span className="feed-meta" aria-live="polite">
          {note ?? "Send them in any order. Payments you send use up this week's allowance, so after lots of sends, Start fresh fills it up again."}
        </span>
      </div>
      {inMore ? (
        <details className="more-scen">
          <summary className="more-scen-sum">
            <span className="more-scen-title">More scenarios</span>
            <span className="more-scen-count">{count} more, from ordinary payments to a business invoice</span>
            <ChevronDown className="more-scen-chev" size={18} strokeWidth={2.2} aria-hidden="true" />
          </summary>
          <div className="more-scen-body">
            {groups}
            {business}
          </div>
        </details>
      ) : (
        groups
      )}
    </div>
  );
}

/** Sends one scenario through Spotter as that person, then keeps the result fresh until its case file arrives. */
function useSend(s: Scenario, spender?: SpenderLite) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each finished send, so focus moves to the new result even when the outcome is the same.
  const [sent, setSent] = useState(0);
  const [sentAt, setSentAt] = useState(0);
  const [polls, setPolls] = useState(0);
  const next = useRef<HTMLAnchorElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (sent) next.current?.focus();
  }, [sent]);

  // The case agent files its case a few seconds after the decision: look again every 3 s, for a minute at most.
  useEffect(() => {
    if (!result || !caseStillComing(result, sentAt, Date.now())) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/payments", { cache: "no-store" });
        const j = await readJson(r);
        if (!r.ok) throw new Error(j.error ?? `status ${r.status}`);
        const fresh = Array.isArray(j.payments) ? (j.payments as Payment[]).find((p) => p.id === result.id) : undefined;
        if (live && fresh) setResult(fresh);
      } catch (e) {
        // The outcome is already on screen and "Open case file" still works: the next look tries again.
        console.warn("[spotter] couldn't look for the case file yet:", e);
      } finally {
        if (live) setPolls((n) => n + 1);
      }
    }, 3000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [result, sentAt, polls]);

  async function run() {
    // The button stays focusable while checking (aria-disabled), so ignore repeat presses here instead.
    if (!spender || running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await fetch("/api/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s.body, spenderId: spender.id }) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}).`);
      setSentAt(Date.now());
      setResult(j.payment);
      setSent((n) => n + 1);
      // A new hold changes the sidebar's "Waiting for you" count: re-render the server shell (client state stays).
      router.refresh();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setRunning(false);
    }
  }
  return { running, result, error, next, run, waiting: !!result && caseStillComing(result, sentAt, Date.now()) };
}

/** What the card shows, in plain words, with the sponsor behind it as a small grey tag. */
function Sees({ s }: { s: Scenario }) {
  if (!s.sees) return null;
  return (
    <p className="scen-sees">
      <span>{s.sees}</span>
      {sponsorsOf(s).length > 0 && (
        <span className="scen-sees-tags">
          {sponsorsOf(s).map((t) => (
            <span key={t} className="scen-tag">
              <span className="sr-only">, with </span>
              {t}
            </span>
          ))}
        </span>
      )}
    </p>
  );
}

function ScenarioCard({ s, short, spender, labels, level }: { s: Scenario; short?: string; spender?: SpenderLite; labels: Labels; level: "h3" | "h4" }) {
  const { running, result, error, next, run, waiting } = useSend(s, spender);
  const state = result ? trackState(result.status) : running ? "checking" : null;
  const Title = level;
  const name = short ?? s.title;
  return (
    <article className="scenario" aria-labelledby={`s-${s.id}`} data-featured={short ? "" : undefined}>
      <Title id={`s-${s.id}`} className="scenario-title">
        {s.title}
      </Title>
      <p className="scenario-body">{s.blurb}</p>
      <Sees s={s} />
      {state && <HoldTrack state={state} from={spender?.name ?? s.who} to={s.body.payee} amount={s.body.amount} currency={s.body.currency} />}
      {result ? <Outcome p={result} waiting={waiting} onAgain={run} running={running} nextRef={next} /> : !short && <p className="scenario-body">Expected: {s.expect}</p>}
      {/* Always in the page, so screen readers hear the change when the text arrives. */}
      <p className="sr-only" role="status">
        {running ? `Checking ${name}.` : result ? `${outcomeLine(result)}${seenPage(result) ? " The case file is ready: what a person sees next to what your agent read." : ""}` : ""}
      </p>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
      <div>
        {spender ? (
          !result && (
            <button type="button" className="btn btn-quiet" onClick={run} aria-disabled={running || undefined} aria-label={running ? `Checking: ${name}` : `Send it: ${name}`}>
              {running ? "Checking" : "Send it"}
            </button>
          )
        ) : (
          <p className="feed-meta">Add {labels.addWho[s.spender]} to try this one.</p>
        )}
      </div>
    </article>
  );
}

/** The outcome in the app's own words (labels.ts): the status, then the reason or the plain sentence for it. */
function outcomeParts(p: Payment): [string, string] {
  const s = trackState(p.status);
  const why = s === "failed" ? p.error : s === "held" ? OUTCOME_WORDS.held.explain : topReason(p);
  return [OUTCOME_WORDS[s].long, why ?? OUTCOME_WORDS[s].explain];
}

function outcomeLine(p: Payment) {
  const [status, why] = outcomeParts(p);
  return `${status}. ${why}`;
}

/** The verdict in one line, the seen vs read evidence when the case found it, and the one sensible next step. */
function Outcome({ p, waiting, onAgain, running, nextRef }: { p: Payment; waiting: boolean; onAgain: () => void; running: boolean; nextRef: React.Ref<HTMLAnchorElement> }) {
  const s = trackState(p.status);
  const [status, why] = outcomeParts(p);
  const tone = s === "held" ? "held" : s === "paid" ? "paid" : "stop";
  const page = seenPage(p);
  return (
    <div className="scen-result" data-tone={tone}>
      <p>
        <strong>{status}.</strong> {why}
      </p>
      {page ? (
        <OpenedPage id={`seen-${p.id}`} page={page} now={null} />
      ) : (
        waiting && <p className="scen-wait">Spotter is building the case file.</p>
      )}
      <div className="scen-next">
        {s === "held" ? (
          <Link ref={nextRef} className="btn btn-primary" href={`/dashboard#pay-${p.id}`}>
            Review it now
          </Link>
        ) : (
          <Link ref={nextRef} className="btn btn-quiet" href={s === "paid" ? "/ledger" : `/dashboard#pay-${p.id}`}>
            {s === "paid" ? "See it in Activity" : "Open case file"}
          </Link>
        )}
        <button type="button" className="scen-again" onClick={onAgain} aria-disabled={running || undefined}>
          {running ? "Checking" : "Send it again"}
        </button>
      </div>
    </div>
  );
}
