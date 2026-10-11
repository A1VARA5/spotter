"use client";
// "PayPal Agent Toolkit: all 47 tools, and what Spotter does with each". Self contained: drop it anywhere (an agent's
// connect panel, /checks). Reads the same table the guarded MCP server runs on (src/core/toolkit-coverage.ts), so what
// it says is what the server does. Pass job to open on that agent's job; the switch flips between the two.
import { useId, useState } from "react";
import { COVERAGE, GROUPS, TOOLKIT_VERSION, type Job, type Treatment } from "@/core/toolkit-coverage";
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

export function ToolkitCoverage({ job: initial = "shopping", headingLevel = 2 }: { job?: Job; headingLevel?: 2 | 3 }) {
  const [job, setJob] = useState<Job>(initial);
  const id = useId();
  const H = `h${headingLevel}` as "h2" | "h3";
  const G = `h${headingLevel + 1}` as "h3" | "h4";
  const counts = Object.fromEntries(ORDER.map((t) => [t, COVERAGE.filter((c) => c[job].treatment === t).length])) as Record<Treatment, number>;

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
            <button key={j} type="button" role="radio" aria-checked={job === j} className="tkc-switch-btn" onClick={() => setJob(j)}>
              {j === "shopping" ? "Shopping agent" : "Selling agent"}
            </button>
          ))}
        </div>
        {job === "selling" && (
          <p className="tkc-note">
            For a family that sells, like a teen reselling on a parent&apos;s PayPal. PayPal accounts are for over 18s, so the parent holds the account and is the spotter.
          </p>
        )}
        <ul className="tkc-legend" aria-label="What each label means">
          {ORDER.map((t) => (
            <li key={t} className="tkc-legend-item">
              <span className={`tkc-badge tkc-${t}`}>
                {LABEL[t]} <span className="tkc-count">{counts[t]}</span>
              </span>
              <span className="tkc-legend-text">{MEANING[t]}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="tkc-groups">
        {GROUPS.map((g) => {
          const rows = COVERAGE.filter((c) => c.group === g).sort((a, b) => ORDER.indexOf(a[job].treatment) - ORDER.indexOf(b[job].treatment));
          return (
            <section key={g} className="tkc-group" aria-labelledby={`${id}-${g.replace(/\W+/g, "")}`}>
              <G id={`${id}-${g.replace(/\W+/g, "")}`} className="tkc-group-title">
                {g} <span className="tkc-group-n">{rows.length}</span>
              </G>
              <ul className="tkc-rows">
                {rows.map((c) => (
                  <li key={c.tool} className={`tkc-row tkc-row-${c[job].treatment}`}>
                    <code className="tkc-tool">{c.tool}</code>
                    <span className={`tkc-badge tkc-${c[job].treatment}`}>{LABEL[c[job].treatment]}</span>
                    <p className="tkc-why">{c[job].why}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
