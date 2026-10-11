"use client";
// The key card: what one agent key can do and what it has done. Prefix, job, allowance left this week, status, the last
// 5 tool calls (arguments shown as plain text: a stranger may have written them), PayPal's own record of which key made
// the newest order, and "Switch off now". Data: GET /api/spenders/[id]/key, POST /api/spenders/[id]/key/off.
import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Confirm } from "./Confirm";
import { money, timeAgo } from "./format";
import { plainError, readJson } from "./http";
import type { KeyCardView } from "@/core/agent-keys";
import "./agent-keys.css";

type View = KeyCardView & { paypalCustomId: string | null; paypalStatus: "match" | "mismatch" | "missing" | "error" | null };

const STATUS: Record<View["status"], string> = { live: "Live", frozen: "Frozen", switched_off: "Switched off", none: "No key yet" };
const JOB: Record<string, string> = { shopping: "Shopping", selling: "Selling" };

export function AgentKeyCard({ agentId, name, refreshKey = 0 }: { agentId: string; name: string; refreshKey?: number }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/spenders/${encodeURIComponent(agentId)}/key`, { cache: "no-store" });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Couldn't load the key (${r.status}).`);
      setView(j as View);
      setError(null);
    } catch (e) {
      setError(plainError(e));
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function switchOff() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/spenders/${encodeURIComponent(agentId)}/key/off`, { method: "POST" });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? "That didn't go through. Try again.");
      await load();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <article className="connect-card key-card" aria-busy={!error || undefined}>
        <h3 className="connect-title">{name}&apos;s key</h3>
        {error ? <p className="field-error" role="alert">{error}</p> : <p className="connect-sub">Loading the key…</p>}
      </article>
    );
  }

  const now = Date.now();
  const record = view.paypalCustomId;
  return (
    <article className="connect-card key-card" aria-labelledby={`key-${agentId}`}>
      <header className="connect-head">
        <span className="connect-icon">
          <KeyRound size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="key-head">
          <h3 id={`key-${agentId}`} className="connect-title">
            {name}&apos;s key <span className="key-label">{view.label}</span>
          </h3>
          <span className="key-status" data-status={view.status}>
            {STATUS[view.status]}
          </span>
        </div>
      </header>

      <dl className="key-facts">
        <div>
          <dt>Job</dt>
          <dd>{JOB[view.job] ?? view.job}</dd>
        </div>
        <div>
          <dt>Allowance left this week</dt>
          <dd className="num">{money(view.allowanceLeft.amount, view.allowanceLeft.currency)}</dd>
        </div>
        <div>
          <dt>Last used</dt>
          <dd suppressHydrationWarning>{view.lastUsedAt ? timeAgo(view.lastUsedAt, now) : "Not yet"}</dd>
        </div>
      </dl>

      {view.order && (
        <p className="key-record" data-status={view.paypalStatus ?? "error"}>
          {view.paypalStatus === "match" && record ? (
            <>
              PayPal&apos;s own record says order {view.order.paypalOrderId} came from key <b>{record.split(":")[0]?.replace("spt-", "spt_…")}</b>.
            </>
          ) : view.paypalStatus === "mismatch" ? (
            <>PayPal&apos;s record for order {view.order.paypalOrderId} names a different key ({record}) than Spotter sent ({view.order.customId}). Check this order in PayPal.</>
          ) : view.paypalStatus === "missing" ? (
            <>PayPal has no key on record for order {view.order.paypalOrderId}. Spotter sent {view.order.customId}.</>
          ) : (
            <>Spotter sent PayPal custom_id {view.order.customId} on order {view.order.paypalOrderId}. PayPal couldn&apos;t be read just now, so this is Spotter&apos;s copy.</>
          )}
        </p>
      )}

      <div className="key-calls">
        <h4 className="key-calls-title">Last tool calls</h4>
        {view.calls.length ? (
          <ol className="key-call-list">
            {view.calls.map((c, i) => (
              <li key={i} className="key-call" data-outcome={c.outcome === "tripwire" ? "tripwire" : c.outcome === "error" || c.outcome === "refused" ? "bad" : "ok"}>
                <span className="key-call-tool">{c.tool}</span>
                <span className="key-call-outcome">{c.outcome === "tripwire" ? "Tripwire" : c.outcome}</span>
                <span className="key-call-time" suppressHydrationWarning>
                  {timeAgo(c.at, now)}
                </span>
                <code className="key-call-args">{c.args}</code>
              </li>
            ))}
          </ol>
        ) : (
          <p className="connect-sub">No calls yet. Each call the agent makes shows here, newest first.</p>
        )}
      </div>

      {view.status === "live" || view.status === "frozen" ? (
        <Confirm
          trigger={busy ? "Switching off" : "Switch off now"}
          triggerClass="btn btn-stop key-off"
          disabled={busy}
          title={`Switch off ${name}'s key?`}
          body={`${name} stops working straight away. No new key is made: make one here when you want it back.`}
          confirmLabel="Switch off now"
          onConfirm={switchOff}
        />
      ) : null}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
