"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { readJson } from "@/ui/http";
import { SignOut } from "@/ui/SignOut";
import { TelegramLogin } from "./TelegramLogin";
import { DiscordAlerts } from "./DiscordAlerts";
import "./account.css";

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
  return j;
}

function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(work: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
      setDone(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, run };
}

function Status({ error, done }: { error: string | null; done: string | null }) {
  if (error)
    return (
      <p className="field-error" role="alert">
        {error}
      </p>
    );
  if (done)
    return (
      <p className="field-ok" role="status">
        {done}
      </p>
    );
  return null;
}

const PIN_LABEL = { current: "Current PIN", pin: "New PIN (4 to 8 digits)", confirm: "New PIN again" } as const;

export function Account({
  spotterName,
  alertEmail,
  inbox,
  demo,
  telegramBot,
  telegramConnected,
  discordApp,
  discordConnected,
}: {
  spotterName: string;
  alertEmail: string | null;
  inbox: string | null;
  demo: boolean;
  telegramBot: string | null;
  telegramConnected: boolean;
  discordApp: string | null;
  discordConnected: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(spotterName);
  const nameForm = useForm();
  const [code, setCode] = useState<string | null>(null);
  const alertForm = useForm();
  const [pin, setPin] = useState({ current: "", pin: "", confirm: "" });
  const pinForm = useForm();
  const [switchTelegram, setSwitchTelegram] = useState(false);
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);

  const nameCard = (
    <form
      className="account-card"
      aria-labelledby="a-name"
      onSubmit={(e) => {
        e.preventDefault();
        nameForm.run(async () => {
          await post("/api/setup/name", { spotterName: name });
          router.refresh();
        }, "Saved.");
      }}
    >
      <h2 id="a-name" className="account-title">
        Your name
      </h2>
      <p className="account-sub">Your people see it when a payment waits for you.</p>
      <label className="sr-only" htmlFor="acc-name">
        Your first name
      </label>
      <input id="acc-name" className="field" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
      <div>
        <button className="btn btn-quiet" disabled={nameForm.busy || !name.trim()}>
          Save name
        </button>
      </div>
      <Status error={nameForm.error} done={nameForm.done} />
    </form>
  );

  return (
    <div className="account">
      {nameCard}

      <h2 className="account-group">Alerts</h2>
      {demo && (
        <p className="account-sub account-note">
          In the demo you don&apos;t need any of these: everything that waits for you shows on your dashboard. Connect your own email, Telegram or Discord only if you
          want to see a real alert arrive.
        </p>
      )}
      <section className="account-card" aria-labelledby="a-alerts">
        <h2 id="a-alerts" className="account-title">
          Email alerts
        </h2>
        <p className="account-sub">When someone&apos;s payment is held or stopped, Spotter emails you what happened and a link to decide.</p>
        <p className="account-value">
          {alertEmail ? (
            <>
              Alerts go to <strong>{alertEmail}</strong>
            </>
          ) : (
            "No alert email yet."
          )}
        </p>
        {code ? (
          <div className="connect-steps">
            <p>
              From the email you want alerts at, send a new email to <strong>{inbox}</strong> with this code in the subject:
            </p>
            <pre className="code-big">{code}</pre>
            <p>Spotter replies to confirm. Then refresh this page. The code works once and lasts 24 hours.</p>
          </div>
        ) : (
          <div>
            <button
              className="btn btn-quiet"
              disabled={alertForm.busy || !inbox}
              onClick={() => alertForm.run(async () => setCode((await post("/api/me/pair", { channel: "email" })).code), "")}
            >
              {alertEmail ? "Use a different email" : "Set my alert email"}
            </button>
          </div>
        )}
        <Status error={alertForm.error} done={null} />
      </section>

      {telegramBot && (
        <section className="account-card" aria-labelledby="a-tg">
          <h2 id="a-tg" className="account-title">
            Telegram alerts
          </h2>
          <p className="account-sub">
            Get each held payment in Telegram, with what Spotter found and a button to deny it on the spot. Approving still happens here, with your PIN.
          </p>
          {telegramConnected && <p className="field-ok">✓ Connected. Alerts go to your Telegram.</p>}
          {telegramConnected && !switchTelegram ? (
            <div>
              <button className="btn btn-quiet" onClick={() => setSwitchTelegram(true)}>
                Use a different Telegram
              </button>
            </div>
          ) : (
            <TelegramLogin bot={telegramBot} />
          )}
        </section>
      )}

      {discordApp && <DiscordAlerts appId={discordApp} connected={discordConnected} />}

      {!demo && <h2 className="account-group">Security</h2>}
      {!demo && (
        <form
          className="account-card"
          aria-labelledby="a-pin"
          onSubmit={(e) => {
            e.preventDefault();
            pinForm.run(async () => {
              await post("/api/account/pin", pin);
              setPin({ current: "", pin: "", confirm: "" });
            }, "PIN changed.");
          }}
        >
          <h2 id="a-pin" className="account-title">
            Change your PIN
          </h2>
          {(["current", "pin", "confirm"] as const).map((k) => (
            <div key={k} className="account-field">
              <label className="field-label" htmlFor={"acc-" + k}>
                {PIN_LABEL[k]}
              </label>
              <input
                id={"acc-" + k}
                className="field field-pin num"
                type="password"
                inputMode="numeric"
                autoComplete={k === "current" ? "current-password" : "new-password"}
                value={pin[k]}
                onChange={(e) => setPin({ ...pin, [k]: digits(e.target.value) })}
              />
            </div>
          ))}
          <div>
            <button className="btn btn-quiet" disabled={pinForm.busy || pin.current.length < 4 || pin.pin.length < 4}>
              Change PIN
            </button>
          </div>
          <Status error={pinForm.error} done={pinForm.done} />
        </form>
      )}

      <section className="account-card" aria-labelledby="a-out">
        <h2 id="a-out" className="account-title">
          Sign out
        </h2>
        <p className="account-sub">{demo ? "You'll lose this demo family. You can start a new one any time." : "Sign back in with PayPal any time."}</p>
        <div>
          <SignOut demo={demo} className="btn btn-deny" />
        </div>
      </section>
    </div>
  );
}
