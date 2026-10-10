"use client";
// Connection cards for one person. Agents get a token shown once; people pair by sending a code.
import { useState } from "react";
import { Bot, Check, Copy, Mail, Send, MessageSquare } from "lucide-react";
import { readJson } from "@/ui/http";

type SpenderView = { id: string; name: string; kind: string; email: string | null; telegram: string | null; discord: string | null };

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
    </div>
  );
}

function useCall<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  async function call(url: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
      setData(j as T);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, data, call };
}

function AgentCard({ spender }: { spender: SpenderView }) {
  const t = useCall<{ token: string }>();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const config = t.data
    ? JSON.stringify({ mcpServers: { spotter: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${t.data.token}` } } } }, null, 2)
    : "";
  return (
    <article className="connect-card">
      <header className="connect-head">
        <span className="connect-icon">
          <Bot size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h3 className="connect-title">Connect {spender.name} with MCP</h3>
          <p className="connect-sub">
            Works with Claude, Claude Code and any agent that speaks MCP. It gets four tools: find products, request a payment, check a
            payment, check its allowance. There is no approve tool.
          </p>
        </div>
      </header>
      <ol className="agent-steps">
        <li>
          <h4 className="agent-step-title">Make a key</h4>
          {t.data ? (
            <p className="connect-warn">Done. This key is shown once, so copy it in the next step now. Making a new one switches this one off.</p>
          ) : (
            <div>
              <button className="btn btn-primary" disabled={t.busy} onClick={() => t.call(`/api/spenders/${spender.id}/token`)}>
                {t.busy ? "Making a key" : "Make a key for this agent"}
              </button>
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
              <CopyBlock label="Claude Code command" value={`claude mcp add --transport http spotter ${origin}/api/mcp --header "Authorization: Bearer ${t.data.token}"`} />
              <p>
                <strong>Claude Desktop or another MCP app:</strong> add this to its MCP config (in Claude Desktop: Settings, Developer, Edit config), then restart it.
              </p>
              <CopyBlock label="MCP config" value={config} />
            </>
          ) : (
            <p className="connect-sub">The command and config to paste appear here once the key is made.</p>
          )}
        </li>
        <li data-off={!t.data}>
          <h4 className="agent-step-title">Ask it to buy something</h4>
          <p className="connect-sub">
            For example: &ldquo;Find me wireless earbuds under £30 and buy the best ones.&rdquo; It searches real shops, then asks Spotter to pay. Anything over{" "}
            the ask me amount shows up on your dashboard to approve.
          </p>
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
          <div className="connect-steps">
            <p>
              1. From the email address {spender.name} uses, send a new email to <strong>{inbox}</strong> with this code in the subject:
            </p>
            <CopyBlock label="Pairing code" value={c.data.code} />
            <p>2. Spotter replies to confirm. The code works once and lasts 24 hours.</p>
          </div>
        ) : channel === "discord" ? (
          <div className="connect-steps">
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
          <div className="connect-steps">
            <p>1. Open this link on {spender.name}&apos;s phone and tap Start:</p>
            <CopyBlock label="Telegram link" value={`https://t.me/${bot}?start=${c.data.code}`} />
            <p>2. That&apos;s it. The link works once and lasts 24 hours.</p>
          </div>
        )
      ) : (
        <div>
          <button className="btn btn-quiet" disabled={c.busy} onClick={() => c.call(`/api/spenders/${spender.id}/pair`, { channel })}>
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
