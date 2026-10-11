"use client";
// Connection cards for one person. Agents get a token shown once; people pair by sending a code.
import { useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Mail, Send, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { plainError, readJson } from "@/ui/http";
import { Confirm } from "@/ui/Confirm";
import { money } from "@/ui/format";
import { ToolkitCoverage } from "@/ui/ToolkitCoverage";
import { AgentJob } from "@/ui/AgentHolds";

type SpenderView = { id: string; name: string; kind: string; email: string | null; telegram: string | null; discord: string | null; currency: string; hasKey?: boolean; job?: "shopping" | "selling" };

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre className="copy-text" aria-label={label}>
        {value}
      </pre>
      <button
        className="btn btn-quiet copy-btn"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? "Copied" : "Copy"}
      </button>
      {/* "Copied" is otherwise only a visual change; this says it out loud. */}
      <span className="sr-only" role="status">
        {copied ? `${label} copied` : ""}
      </span>
    </div>
  );
}

/** Focus moves to what a button just made (the key, the code) instead of dropping to the page when the button goes. */
function useFocusWhen<T extends HTMLElement>(ready: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ready) ref.current?.focus();
  }, [ready]);
  return ref;
}

function useCall<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  async function call(url: string, body: unknown = {}, method = "POST"): Promise<boolean> {
    // Busy buttons stay focusable (aria-disabled), so ignore repeat presses here.
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
      setData(j as T);
      return true;
    } catch (e) {
      setError(plainError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, data, call };
}

// Two ways in: Spotter's own tools, or PayPal's official Agent Toolkit tools with Spotter in the middle.
const TOOLSETS = {
  spotter: {
    label: "Spotter's tools",
    path: "/api/mcp",
    server: "spotter",
    sub: "Four tools: find products at real shops (Channel3), request a payment, check a payment, check its allowance. There is no approve tool.",
  },
  toolkit: {
    label: "PayPal's Agent Toolkit",
    path: "/api/toolkit/mcp",
    server: "paypal-via-spotter",
    sub: "PayPal's own tools, with the same names and arguments. Spotter sits in the middle: orders, refunds and subscriptions wait for you, and a tool a hijacked agent reaches for freezes it.",
  },
} as const;

function AgentCard({ spender }: { spender: SpenderView }) {
  const t = useCall<{ token: string }>();
  const cur = useCall<{ currency: string; spentOtherCurrency?: { amount: number; currency: string } }>();
  const router = useRouter();
  // Refresh the server rendered "Spent this week" so it shows the new currency's tally straight away.
  const switchTo = async (currency: "GBP" | "USD") => {
    if (await cur.call(`/api/spenders/${spender.id}`, { currency }, "PATCH")) router.refresh();
  };
  const done = useFocusWhen<HTMLParagraphElement>(t.data);
  const [tools, setTools] = useState<keyof typeof TOOLSETS>("spotter");
  const set = TOOLSETS[tools];
  const currency = cur.data?.currency ?? spender.currency;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const config = t.data
    ? // Claude Desktop's config starts local servers, so mcp-remote bridges to Spotter's URL. The header has no space
      // after the colon and the key sits in env, the form mcp-remote's README gives because Windows mangles spaces in args.
      JSON.stringify(
        {
          mcpServers: {
            [set.server]: {
              command: "npx",
              args: ["mcp-remote", `${origin}${set.path}`, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: `Bearer ${t.data.token}` },
            },
          },
        },
        null,
        2,
      )
    : "";
  return (
    <article className="connect-card">
      <header className="connect-head">
        <span className="connect-icon">
          <Bot size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h3 className="connect-title">Connect {spender.name} with MCP</h3>
          <p className="connect-sub">Works with Claude, Claude Code and any agent that speaks MCP. One key works for both sets of tools.</p>
        </div>
      </header>
      <div className="toolset" role="group" aria-label="Which tools the agent gets">
        {(Object.keys(TOOLSETS) as Array<keyof typeof TOOLSETS>).map((k) => (
          <button key={k} type="button" className="toolset-btn" aria-pressed={tools === k} onClick={() => setTools(k)}>
            {TOOLSETS[k].label}
          </button>
        ))}
      </div>
      <p className="connect-sub">{set.sub}</p>
      {tools === "toolkit" && (
        <>
          <AgentJob agentId={spender.id} job={spender.job ?? "shopping"} />
          <ToolkitCoverage job={spender.job ?? "shopping"} headingLevel={3} />
        </>
      )}
      {tools === "toolkit" && currency !== "USD" && (
        <div className="connect-warn">
          <p>PayPal&apos;s toolkit makes orders in US dollars, and {spender.name}&apos;s allowance is in pounds, so its orders would be stopped.</p>
          <p>This week&apos;s spend is counted per currency, so after the switch the dollar tally starts at nothing and the pounds already spent stay on the pound tally.</p>
          <button className="btn btn-quiet" aria-disabled={cur.busy || undefined} onClick={() => switchTo("USD")}>
            {cur.busy ? "Switching" : "Set this agent's allowance in dollars"}
          </button>
          {cur.error && <p className="field-error" role="alert">{cur.error}</p>}
        </div>
      )}
      {currency === "USD" && (
        <div className="connect-warn">
          <p>
            {spender.name}&apos;s allowance is in US dollars, so pound payments are stopped. This week&apos;s spend is counted per currency
            {cur.data?.spentOtherCurrency?.amount ? `: ${money(cur.data.spentOtherCurrency.amount, cur.data.spentOtherCurrency.currency)} spent in pounds this week isn't in the dollar tally.` : "."}
          </p>
          <button className="btn btn-quiet" disabled={cur.busy} onClick={() => switchTo("GBP")}>
            {cur.busy ? "Switching" : "Set back to pounds"}
          </button>
          {cur.error && <p className="field-error" role="alert">{cur.error}</p>}
        </div>
      )}
      <ol className="agent-steps">
        <li>
          <h4 className="agent-step-title">Make a key</h4>
          {t.data ? (
            <p ref={done} tabIndex={-1} className="connect-warn">Done. This key is shown once, so copy it in the next step now. Making a new one switches this one off.</p>
          ) : (
            <div>
              {spender.hasKey ? (
                <>
                  <p className="connect-sub">{spender.name} already has a working key. Spotter can&apos;t show it again, so a new one replaces it.</p>
                  <Confirm
                    trigger={t.busy ? "Making a key" : "Make a new key"}
                    triggerClass="btn btn-primary"
                    disabled={t.busy}
                    title="Make a new key?"
                    body={`This switches off the key your agent uses now. ${spender.name} stops working until you give it the new one.`}
                    confirmLabel="Make a new key"
                    onConfirm={() => t.call(`/api/spenders/${spender.id}/token`)}
                  />
                </>
              ) : (
                <button className="btn btn-primary" aria-disabled={t.busy || undefined} onClick={() => t.call(`/api/spenders/${spender.id}/token`)}>
                  {t.busy ? "Making a key" : "Make a key for this agent"}
                </button>
              )}
            </div>
          )}
        </li>
        <li data-off={!t.data}>
          <h4 className="agent-step-title">Give it to your agent</h4>
          {t.data ? (
            <>
              <p>
                <strong>Claude Code:</strong> run this in a terminal.
              </p>
              <CopyBlock label="Claude Code command" value={`claude mcp add --transport http ${set.server} ${origin}${set.path} --header "Authorization: Bearer ${t.data.token}"`} />
              <p>
                <strong>Claude Desktop:</strong> add this to its config (Settings, Developer, Edit config), then restart it. It needs Node.js, because
                mcp-remote connects the desktop app to Spotter.
              </p>
              <CopyBlock label="MCP config" value={config} />
            </>
          ) : (
            <p className="connect-sub">The command and config to paste appear here once the key is made.</p>
          )}
        </li>
        <li data-off={!t.data}>
          <h4 className="agent-step-title">Ask it to buy something</h4>
          {tools === "spotter" ? (
            <p className="connect-sub">
              For example: &quot;Find me wireless earbuds under £30 and buy the best ones.&quot; It searches real shops (Channel3), then asks Spotter to pay. Anything over{" "}
              the ask me amount shows up on your dashboard to approve.
            </p>
          ) : (
            <p className="connect-sub">
              For example: &quot;Use PayPal to order a $45 desk lamp from BrightHome and pay for it.&quot; The agent calls PayPal&apos;s create_order and pay_order as usual.
              Spotter checks the order first, and anything over the ask me amount waits on your dashboard; pay_order only reports what Spotter decided.
            </p>
          )}
        </li>
      </ol>
      <p className="connect-sub">
        No agent yet? <a href="/demo">Try the agent scenarios</a> to see exactly what it would get back.
      </p>
      {t.error && (
        <p className="field-error" role="alert">
          {t.error}
        </p>
      )}
    </article>
  );
}

function CodeCard({ spender, channel, inbox, bot }: { spender: SpenderView; channel: "email" | "telegram" | "discord"; inbox: string | null; bot: string | null }) {
  const c = useCall<{ code: string }>();
  const steps = useFocusWhen<HTMLDivElement>(c.data);
  const connected = channel === "email" ? spender.email : channel === "telegram" ? spender.telegram : spender.discord;
  const Icon = channel === "email" ? Mail : channel === "telegram" ? Send : MessageSquare;
  const title = { email: "Email", telegram: "Telegram", discord: "Discord" }[channel];
  return (
    <article className="connect-card">
      <header className="connect-head">
        <span className="connect-icon">
          <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h3 className="connect-title">{title}</h3>
          <p className="connect-sub">
            {channel === "email"
              ? `${spender.name} forwards any email that asks for money to ${inbox}. Spotter checks it and replies in the same thread.`
              : channel === "telegram"
                ? `${spender.name} sends or forwards payment requests to the Spotter bot on Telegram.`
                : `${spender.name} right clicks a message on Discord and picks Check with Spotter.`}
          </p>
        </div>
        <span className="connect-status" data-on={Boolean(connected)}>
          {connected ? (channel === "email" ? `Connected as ${connected}` : "Connected") : "Not connected"}
        </span>
      </header>
      {c.data ? (
        channel === "email" ? (
          <div ref={steps} tabIndex={-1} className="connect-steps">
            <p>
              1. From the email address {spender.name} uses, send a new email to <strong>{inbox}</strong> with this code in the subject:
            </p>
            <CopyBlock label="Pairing code" value={c.data.code} />
            <p>2. Spotter replies to confirm. The code works once and lasts 24 hours.</p>
          </div>
        ) : channel === "discord" ? (
          <div ref={steps} tabIndex={-1} className="connect-steps">
            <p>
              1. {spender.name} adds Spotter to their Discord account:{" "}
              <a href={`https://discord.com/oauth2/authorize?client_id=${bot}`} target="_blank" rel="noopener noreferrer">
                add the app
              </a>
              .
            </p>
            <p>2. In any chat, they type this and press enter:</p>
            <CopyBlock label="Discord command" value={`/spotter connect code:${c.data.code}`} />
            <p>3. That&apos;s it. The code works once and lasts 24 hours.</p>
          </div>
        ) : (
          <div ref={steps} tabIndex={-1} className="connect-steps">
            <p>1. Open this link on {spender.name}&apos;s phone and tap Start:</p>
            <CopyBlock label="Telegram link" value={`https://t.me/${bot}?start=${c.data.code}`} />
            <p>2. That&apos;s it. The link works once and lasts 24 hours.</p>
          </div>
        )
      ) : (
        <div>
          <button className="btn btn-quiet" aria-disabled={c.busy || undefined} onClick={() => c.call(`/api/spenders/${spender.id}/pair`, { channel })}>
            {c.busy ? "Making a code" : connected ? "Connect a different one" : `Connect ${channel === "email" ? "email" : title}`}
          </button>
        </div>
      )}
      {c.error && (
        <p className="field-error" role="alert">
          {c.error}
        </p>
      )}
    </article>
  );
}

export function Connect({ spender, inbox, telegramBot, discordApp }: { spender: SpenderView; inbox: string | null; telegramBot: string | null; discordApp: string | null }) {
  if (spender.kind === "agent")
    return (
      <div className="connect-grid">
        <AgentCard spender={spender} />
      </div>
    );
  return (
    <div className="connect-grid">
      {inbox && <CodeCard spender={spender} channel="email" inbox={inbox} bot={telegramBot} />}
      {telegramBot && <CodeCard spender={spender} channel="telegram" inbox={inbox} bot={telegramBot} />}
      {discordApp && <CodeCard spender={spender} channel="discord" inbox={inbox} bot={discordApp} />}
      {!inbox && !telegramBot && !discordApp && <p className="lede">No channels are switched on for this Spotter yet.</p>}
    </div>
  );
}
