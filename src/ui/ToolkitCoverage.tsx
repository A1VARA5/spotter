"use client";
// "PayPal Agent Toolkit: all 47 tools, and what Spotter does with each". Self contained: drop it anywhere (an agent's
// connect panel, /checks). Reads the same table the guarded MCP server runs on (src/core/toolkit-coverage.ts), so what
// it says is what the server does. Pass job to open on that agent's job; the switch flips between the two.
// Laid out like a reference table: a summary row of treatments first (each one a filter), then one folding section
// per category with a three column table inside. Categories where Spotter does real work start open.
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { COVERAGE, GROUPS, TOOLKIT_VERSION, type Group, type Job, type Treatment } from "@/core/toolkit-coverage";
import "./toolkit.css";

const LABEL: Record<Treatment, string> = {
  guarded: "Guarded",
  passthrough: "Passed through",
  bait: "Tripwire",
  hidden: "Not offered",
};

const MEANING: Record<Treatment, string> = {
  guarded: "Goes through Spotter's checks. Anything that moves money waits for the spotter's PIN.",
  passthrough: "Runs PayPal's real tool, only on things Spotter made for this family.",
  bait: "Offered with PayPal's own name, never runs. An agent that calls it is paused and the spotter is told.",
  hidden: "Not offered to the agent at all.",
};

const ORDER: Treatment[] = ["guarded", "passthrough", "bait", "hidden"];
const slug = (g: string) => g.replace(/\W+/g, "");
/** Open by default: the categories where Spotter does more than refuse. */
const worthOpening = (job: Job) => new Set(GROUPS.filter((g) => COVERAGE.some((c) => c.group === g && (c[job].treatment === "guarded" || c[job].treatment === "passthrough"))));

export function ToolkitCoverage({ job: initial = "shopping", headingLevel = 2 }: { job?: Job; headingLevel?: 2 | 3 }) {
  const [job, setJob] = useState<Job>(initial);
  const [only, setOnly] = useState<Treatment | null>(null);
  const [open, setOpen] = useState<Set<Group>>(() => worthOpening(initial));
  const id = useId();
  const H = `h${headingLevel}` as "h2" | "h3";
  const G = `h${headingLevel + 1}` as "h3" | "h4";
  const counts = Object.fromEntries(ORDER.map((t) => [t, COVERAGE.filter((c) => c[job].treatment === t).length])) as Record<Treatment, number>;
  const shown = COVERAGE.filter((c) => !only || c[job].treatment === only);

  function pickJob(j: Job) {
    setJob(j);
    setOnly(null);
    setOpen(worthOpening(j));
  }

  function toggle(g: Group, isOpen: boolean) {
    // While a filter is on every matching category is shown open; folding then only matters once it is cleared.
    if (only) return;
    setOpen((s) => {
      if (s.has(g) === isOpen) return s;
      const n = new Set(s);
      if (isOpen) n.add(g);
      else n.delete(g);
      return n;
    });
  }

  const allOpen = GROUPS.every((g) => open.has(g));

  return (
    <section className="tkc" aria-labelledby={`${id}-title`}>
      <header className="tkc-head">
        <H id={`${id}-title`} className="tkc-title">
          PayPal Agent Toolkit: all {COVERAGE.length} tools, and what Spotter does with each
        </H>
        <p className="tkc-lede">
          PayPal&apos;s toolkit (version {TOOLKIT_VERSION}) is built for the account that gets paid: refunds, invoices, tracking and subscriptions.
          So what&apos;s safe depends on the agent&apos;s job.
        </p>
        <div className="tkc-switch" role="radiogroup" aria-label="Agent's job">
          {(["shopping", "selling"] as Job[]).map((j) => (
            <button key={j} type="button" role="radio" aria-checked={job === j} className="tkc-switch-btn" onClick={() => pickJob(j)}>
              {j === "shopping" ? "Shopping agent" : "Selling agent"}
            </button>
          ))}
        </div>
        {job === "selling" && (
          <p className="tkc-note">
            For a family that sells, like a teen reselling on a parent&apos;s PayPal. PayPal accounts are for over 18s, so the parent holds the account and is the spotter.
          </p>
        )}
      </header>

      <div className="tkc-summary" role="group" aria-label="Show tools by what Spotter does">
        <button type="button" className="tkc-stat" data-t="all" aria-pressed={only === null} onClick={() => setOnly(null)}>
          <span className="tkc-stat-top">
            <span className="tkc-stat-label">All tools</span>
            <span className="tkc-stat-n">{COVERAGE.length}</span>
          </span>
          <span className="tkc-stat-text">Every tool in PayPal&apos;s toolkit, by category.</span>
        </button>
        {ORDER.map((t) => (
          <button key={t} type="button" className="tkc-stat" data-t={t} aria-pressed={only === t} onClick={() => setOnly(only === t ? null : t)}>
            <span className="tkc-stat-top">
              <span className={`tkc-badge tkc-${t}`}>{LABEL[t]}</span>
              <span className="tkc-stat-n">{counts[t]}</span>
            </span>
            <span className="tkc-stat-text">{MEANING[t]}</span>
          </button>
        ))}
      </div>

      <div className="tkc-bar">
        <p className="tkc-showing" role="status">
          {only ? `Showing the ${shown.length} ${LABEL[only].toLowerCase()} tools.` : `Showing all ${COVERAGE.length} tools in ${GROUPS.length} categories.`}
        </p>
        {!only && (
          <button type="button" className="tkc-foldall" onClick={() => setOpen(allOpen ? new Set() : new Set(GROUPS))}>
            {allOpen ? "Fold every category" : "Open every category"}
          </button>
        )}
      </div>

      <div className="tkc-groups">
        {GROUPS.map((g) => {
          const all = COVERAGE.filter((c) => c.group === g);
          const rows = all.filter((c) => !only || c[job].treatment === only).sort((a, b) => ORDER.indexOf(a[job].treatment) - ORDER.indexOf(b[job].treatment));
          if (rows.length === 0) return null;
          const mix = ORDER.filter((t) => all.some((c) => c[job].treatment === t)).map((t) => `${all.filter((c) => c[job].treatment === t).length} ${LABEL[t].toLowerCase()}`);
          const isOpen = only ? true : open.has(g);
          return (
            <details key={`${job}-${g}`} className="tkc-group" open={isOpen} onToggle={(e) => toggle(g, e.currentTarget.open)}>
              <summary className="tkc-sum">
                <ChevronRight size={18} strokeWidth={2} aria-hidden="true" className="tkc-chev" />
                <G id={`${id}-${slug(g)}`} className="tkc-group-title">
                  {g}
                </G>
                <span className="tkc-group-n">{all.length === 1 ? "1 tool" : `${all.length} tools`}</span>
                <span className="tkc-mix">{mix.join(", ")}</span>
              </summary>
              <table className="tkc-table" aria-labelledby={`${id}-${slug(g)}`}>
                <colgroup>
                  <col className="tkc-col-tool" />
                  <col className="tkc-col-t" />
                  <col />
                </colgroup>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Tool</th>
                    <th scope="col">What Spotter does</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.tool} className={`tkc-row tkc-row-${c[job].treatment}`}>
                      <th scope="row" className="tkc-cell-tool">
                        {/* Long names break after an underscore on phones, never mid word. */}
                        <code className="tkc-tool" translate="no">
                          {c.tool.split("_").map((part, i) => (
                            <span key={i}>
                              {i > 0 && "_"}
                              {i > 0 && <wbr />}
                              {part}
                            </span>
                          ))}
                        </code>
                      </th>
                      <td className="tkc-cell-t">
                        <span className={`tkc-badge tkc-${c[job].treatment}`}>{LABEL[c[job].treatment]}</span>
                      </td>
                      <td className="tkc-why">{c[job].why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
      </div>
    </section>
  );
}
