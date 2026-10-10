"use client";
// The spotter connects their own Discord for alert DMs: add the app, then send the code with /spotter connect.
import { useState } from "react";
import { readJson } from "@/ui/http";

export function DiscordAlerts({ appId, connected }: { appId: string; connected: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/me/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "discord" }) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? "Couldn't make a code. Try again.");
      setCode(j.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-card" aria-labelledby="a-dc">
      <h2 id="a-dc" className="account-title">
        Discord alerts
      </h2>
      <p className="account-sub">Get each held payment as a Discord DM, with a button to deny it. Approving still happens here, with your PIN.</p>
      {connected && <p className="field-ok">✓ Connected. Alerts go to your Discord.</p>}
      {code ? (
        <div className="connect-steps">
          <p>
            1.{" "}
            <a href={`https://discord.com/oauth2/authorize?client_id=${appId}`} target="_blank" rel="noopener noreferrer">
              Add Spotter to your Discord account
            </a>
            .
          </p>
          <p>2. In any chat, send this:</p>
          <pre className="code-big">/spotter connect code:{code}</pre>
          <p>The code works once and lasts 24 hours.</p>
        </div>
      ) : (
        <div>
          <button className="btn btn-quiet" disabled={busy} onClick={make}>
            {busy ? "Making a code" : connected ? "Use a different Discord" : "Connect my Discord"}
          </button>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
