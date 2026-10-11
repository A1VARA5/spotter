"use client";
// First run setup. One question per screen; the server decides where to resume, so leaving halfway is fine.
// What's typed or picked is shared with the preview on the right, so it shows what this step sets up as you go.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, BriefcaseBusiness, HeartHandshake, House, Smile, Store, X } from "lucide-react";
import { money } from "@/ui/format";
import { readJson } from "@/ui/http";
import { Confirm } from "@/ui/Confirm";
import { labelsFor, type Labels } from "@/ui/labels";
import { BrandMark } from "@/ui/components";
import type { HouseholdKind } from "@/core/households";
import { Preview, type Channel, type Draft } from "./Preview";

export type SetupStep = "name" | "pin" | "people" | "connect";
type Person = { id: string; name: string; kind: string };
type PresetView = { key: string; label: string; hint: string; weekly: number; askAbove: number };

const ORDER: SetupStep[] = ["name", "pin", "people", "connect"];
const STEP_NAME: Record<SetupStep, string> = { name: "You", pin: "PIN", people: "People", connect: "Alerts" };
/** What comes after each step, said beside its button so nobody has to wonder. */
const NEXT: Record<SetupStep, string> = {
  name: "Next: a PIN only you know",
  pin: "Next: who you look out for",
  people: "Next: how alerts reach you",
  connect: "Next: your dashboard",
};
const PRESET_ICON: Record<string, React.ReactNode> = {
  relative: <HeartHandshake size={22} strokeWidth={1.75} aria-hidden="true" />,
  kid: <Smile size={22} strokeWidth={1.75} aria-hidden="true" />,
  agent: <Bot size={22} strokeWidth={1.75} aria-hidden="true" />,
  staff: <BriefcaseBusiness size={22} strokeWidth={1.75} aria-hidden="true" />,
  buyer: <Bot size={22} strokeWidth={1.75} aria-hidden="true" />,
};
const HOUSEHOLD_CHOICES: Array<{ kind: HouseholdKind; label: string; hint: string; icon: React.ReactNode }> = [
  { kind: "family", label: "My family", hint: "Gran, the kids, a shopping agent.", icon: <House size={22} strokeWidth={1.75} aria-hidden="true" /> },
  { kind: "business", label: "My small business", hint: "Staff and AI buying agents paying suppliers.", icon: <Store size={22} strokeWidth={1.75} aria-hidden="true" /> },
];
const CHANNELS: Array<{ key: Channel; label: string; hint: string }> = [
  { key: "telegram", label: "Telegram", hint: "A message from the Spotter bot, with Deny right under it." },
  { key: "discord", label: "Discord", hint: "A direct message from the Spotter app, with Deny." },
  { key: "email", label: "Email", hint: "An email saying what happened, with a link to decide." },
];

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
  return j;
}

type SetupProps = {
  step: SetupStep;
  spotterName: string;
  pinSet: boolean;
  people: Person[];
  presets: PresetView[];
  kind: HouseholdKind;
  /** Alert channels already connected on the account page, so the alerts step can say so. */
  connected: Channel[];
};
type DraftApi = { draft: Draft; set: (patch: Partial<Draft>) => void };

export function Setup(props: SetupProps) {
  const labels = labelsFor(props.kind);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [props.step]);
  const [draft, setDraft] = useState<Draft>({
    name: props.spotterName === "You" ? "" : props.spotterName,
    kind: props.kind,
    pinLength: 0,
    person: null,
    channel: props.connected[0] ?? "telegram",
  });
  const api: DraftApi = { draft, set: (patch) => setDraft((d) => ({ ...d, ...patch })) };
  // Always four steps, so the count never changes halfway. Once there's a PIN its step stays ticked (Back skips it).
  const order = ORDER;
  const n = order.indexOf(props.step) + 1;
  return (
    <main className="setup-split">
      <div className="setup-shell">
        <a href="/" className="brand setup-brand" aria-label="Spotter home">
          <BrandMark />
          Spotter
        </a>
        <section className="setup" aria-labelledby="setup-q">
          <ol className="setup-steps" aria-label={`Setup, step ${n} of ${order.length}`}>
            {order.map((s, i) => (
              <li key={s} data-done={i < n - 1 || (s === "pin" && props.pinSet && i !== n - 1) || undefined} aria-current={i === n - 1 ? "step" : undefined}>
                <span className="setup-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                {STEP_NAME[s]}
              </li>
            ))}
          </ol>
          {props.step === "name" && <NameStep {...api} pinSet={props.pinSet} heading={heading} />}
          {props.step === "pin" && <PinStep {...api} heading={heading} />}
          {props.step === "people" && <PeopleStep {...api} people={props.people} presets={props.presets} labels={labels} heading={heading} />}
          {props.step === "connect" && <ConnectStep {...api} people={props.people} connected={props.connected} labels={labels} heading={heading} />}
        </section>
      </div>
      <Preview step={props.step} draft={draft} people={props.people} labels={labels} connected={props.connected} />
    </main>
  );
}

type H = { heading: React.RefObject<HTMLHeadingElement | null> };

function Question({ heading, children, sub }: H & { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <>
      <h1 id="setup-q" className="setup-q" ref={heading} tabIndex={-1}>
        {children}
      </h1>
      {sub && <p className="setup-sub">{sub}</p>}
    </>
  );
}

function NextUp({ step }: { step: SetupStep }) {
  return <p className="setup-next">{NEXT[step]}</p>;
}

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(work: () => Promise<unknown>, next?: SetupStep | "dashboard") {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (next === "dashboard") router.push("/dashboard?welcome=setup");
      else if (next) router.push(`/setup?step=${next}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function FieldError({ id, error }: { id: string; error: string | null }) {
  if (!error) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {error}
    </p>
  );
}

function NameStep({ heading, pinSet, draft, set }: H & DraftApi & { pinSet: boolean }) {
  const { name, kind } = draft;
  const { busy, error, run } = useSubmit();
  return (
    <form className="setup-form" onSubmit={(e) => (e.preventDefault(), run(() => post("/api/setup/name", { spotterName: name, kind }), pinSet ? "people" : "pin"))}>
      <p className="setup-intro">Spotter holds a risky payment at PayPal until you&apos;ve had a look. Setup takes about two minutes.</p>
      <Question heading={heading} sub={labelsFor(kind).nameSub}>
        What should we call you?
      </Question>
      <label className="field-label" htmlFor="spotter-name">
        Your first name
      </label>
      <input
        id="spotter-name"
        className="field"
        autoComplete="given-name"
        value={name}
        maxLength={40}
        onChange={(e) => set({ name: e.target.value })}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "name-error" : undefined}
        required
      />
      <fieldset className="preset-group kind-group">
        <legend className="field-label">Spotter is for</legend>
        {HOUSEHOLD_CHOICES.map((c) => (
          <label key={c.kind} className="preset" data-checked={kind === c.kind}>
            <input type="radio" name="household-kind" value={c.kind} checked={kind === c.kind} onChange={() => set({ kind: c.kind })} className="sr-only" />
            <span className="preset-icon">{c.icon}</span>
            <span className="preset-text">
              <span className="preset-label">{c.label}</span>
              <span className="preset-hint">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <FieldError id="name-error" error={error} />
      <div className="setup-actions">
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? "Saving" : "Continue"}
        </button>
        <NextUp step={pinSet ? "pin" : "name"} />
      </div>
    </form>
  );
}

function PinStep({ heading, set }: H & DraftApi) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useSubmit();
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);
  return (
    <form className="setup-form" onSubmit={(e) => (e.preventDefault(), run(() => post("/api/setup/pin", { pin, confirm }), "people"))}>
      <Question heading={heading} sub="You'll type it to approve or deny a payment, so an agent or a stranger with your laptop can't.">
        Choose a PIN
      </Question>
      <label className="field-label" htmlFor="pin">
        4 to 8 digits
      </label>
      <input
        id="pin"
        className="field field-pin num"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={pin}
        onChange={(e) => {
          const v = digits(e.target.value);
          setPin(v);
          set({ pinLength: v.length });
        }}
        required
      />
      <label className="field-label" htmlFor="pin-confirm">
        Type it again
      </label>
      <input
        id="pin-confirm"
        className="field field-pin num"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(digits(e.target.value))}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "pin-error" : undefined}
        required
      />
      <FieldError id="pin-error" error={error} />
      <div className="setup-actions">
        <a className="btn btn-quiet" href="/setup?step=name">
          Back
        </a>
        <button className="btn btn-primary" disabled={busy || pin.length < 4 || confirm.length < 4}>
          {busy ? "Saving" : "Set PIN"}
        </button>
        <NextUp step="pin" />
      </div>
    </form>
  );
}

function PeopleStep({ heading, people, presets, labels, set }: H & DraftApi & { people: Person[]; presets: PresetView[]; labels: Labels }) {
  const [form, setForm] = useState<{ preset: string | null; name: string; weekly: string; askAbove: string }>({ preset: null, name: "", weekly: "", askAbove: "" });
  const { preset, name, weekly, askAbove } = form;
  const add = useSubmit();
  const remove = useSubmit();
  const chosen = presets.find((p) => p.key === preset);
  const pence = (v: string) => (v.trim() === "" ? undefined : Math.round(Number(v) * 100));

  /** Changes the form and tells the preview, which shows the person being added with the rule exactly as typed. */
  function update(patch: Partial<typeof form>) {
    const next = { ...form, ...patch };
    setForm(next);
    const c = presets.find((p) => p.key === next.preset);
    set({
      person: c ? { label: c.label, name: next.name, agent: c.key === "agent" || c.key === "buyer", weekly: pence(next.weekly), askAbove: pence(next.askAbove) } : null,
    });
  }

  function choose(key: string) {
    const p = presets.find((x) => x.key === key)!;
    const agent = p.key === "agent" || p.key === "buyer";
    update({ preset: key, weekly: String(p.weekly / 100), askAbove: String(p.askAbove / 100), ...(agent && !name ? { name: labels.agentName } : {}) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await add.run(() => post("/api/spenders", { name, preset, weeklyPence: pence(weekly), askAbovePence: pence(askAbove) }));
    update({ preset: null, name: "" });
  }

  return (
    <div className="setup-form">
      <Question heading={heading} sub={labels.peopleSub}>
        {labels.peopleQ}
      </Question>

      {people.length > 0 && (
        <ul className="people-list" aria-label="Added so far">
          {people.map((p) => (
            <li key={p.id} className="person-row">
              <span className="person-name">{p.name}</span>
              <span className="person-kind">{labels.kind[p.kind] ?? p.kind}</span>
              <Confirm
                trigger={<X size={18} strokeWidth={1.75} aria-hidden="true" />}
                triggerClass="icon-btn"
                triggerLabel={`Remove ${p.name}`}
                disabled={remove.busy}
                title={`Remove ${p.name}?`}
                body={`${p.name} and their payment history will be deleted. Anything they forward afterwards won't be checked.`}
                confirmLabel={`Remove ${p.name}`}
                onConfirm={() =>
                  remove.run(async () => {
                    const r = await fetch(`/api/spenders/${p.id}`, { method: "DELETE" });
                    if (!r.ok) throw new Error((await readJson(r)).error ?? "Couldn't remove them. Try again.");
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <form className="person-add" onSubmit={submit}>
        <fieldset className="preset-group">
          <legend className="field-label">{people.length ? "Add someone else" : "They are"}</legend>
          {presets.map((p) => (
            <label key={p.key} className="preset" data-checked={preset === p.key}>
              <input type="radio" name="preset" value={p.key} checked={preset === p.key} onChange={() => choose(p.key)} className="sr-only" />
              <span className="preset-icon">{PRESET_ICON[p.key]}</span>
              <span className="preset-text">
                <span className="preset-label">{p.label}</span>
                <span className="preset-hint">{p.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {chosen && (
          <div className="person-details">
            <label className="field-label" htmlFor="person-name">
              {chosen.key === "agent" || chosen.key === "buyer" ? "What should we call this agent?" : "Their name"}
            </label>
            <input id="person-name" className="field" autoFocus value={name} maxLength={40} autoComplete="off" onChange={(e) => update({ name: e.target.value })} required />
            <div className="money-pair">
              <div>
                <label className="field-label" htmlFor="weekly">
                  Weekly limit (£)
                </label>
                <input id="weekly" className="field num" inputMode="decimal" value={weekly} onChange={(e) => update({ weekly: e.target.value.replace(/[^\d.]/g, "") })} />
              </div>
              <div>
                <label className="field-label" htmlFor="ask-above">
                  Ask me above (£)
                </label>
                <input id="ask-above" className="field num" inputMode="decimal" value={askAbove} onChange={(e) => update({ askAbove: e.target.value.replace(/[^\d.]/g, "") })} />
              </div>
            </div>
            <p className="setup-note">
              Payments up to {money(pence(askAbove) ?? chosen.askAbove, "GBP")} go through if nothing looks wrong. Anything bigger, or anything that looks like a scam, waits for you.
            </p>
            <FieldError id="person-error" error={add.error} />
            <div className="setup-actions">
              <button className="btn btn-quiet" disabled={add.busy || !name.trim()}>
                {add.busy ? "Adding" : `Add ${name.trim() || "them"}`}
              </button>
            </div>
          </div>
        )}
      </form>
      <FieldError id="remove-error" error={remove.error} />

      <div className="setup-actions setup-footer">
        <a className="btn btn-quiet" href="/setup?step=name">
          Back
        </a>
        {people.length > 0 ? (
          <span className="setup-go">
            <NextUp step="people" />
            <a className="btn btn-primary" href="/setup?step=connect">
              Continue
            </a>
          </span>
        ) : (
          <a className="setup-skip" href="/dashboard">
            I&apos;ll do this later
          </a>
        )}
      </div>
    </div>
  );
}

function ConnectStep({ heading, people, labels, connected, draft, set }: H & DraftApi & { people: Person[]; labels: Labels; connected: Channel[] }) {
  const first = people.find((p) => p.kind !== "agent")?.name ?? people[0]?.name;
  const channel = CHANNELS.find((c) => c.key === draft.channel)!;
  const isOn = connected.includes(draft.channel);
  const business = draft.kind === "business";
  return (
    <div className="setup-form">
      <Question heading={heading} sub="When a payment needs you, this is where you hear about it. Deny works from the alert; approving always needs your PIN.">
        How should alerts reach you?
      </Question>
      <fieldset className="channel-group">
        <legend className="sr-only">Alerts by</legend>
        {CHANNELS.map((c) => (
          <label key={c.key} className="channel" data-checked={draft.channel === c.key}>
            <input type="radio" name="channel" value={c.key} checked={draft.channel === c.key} onChange={() => set({ channel: c.key })} className="sr-only" />
            <span className="channel-label">{c.label}</span>
            {connected.includes(c.key) && <span className="channel-on">Connected</span>}
          </label>
        ))}
      </fieldset>
      <p className="setup-note">
        {channel.hint}{" "}
        {isOn ? (
          `${channel.label} is connected.`
        ) : (
          <>
            <a href="/account">Set up {channel.label} alerts on your account page</a>, about a minute. Until then, everything waiting shows on your dashboard.
          </>
        )}
      </p>

      <h2 className="setup-h2">{business ? "Connect your staff and agents" : "Connect your people"}</h2>
      <p className="setup-note">Each one connects once, from their own phone, email or agent. Now, or any time from their page.</p>
      <ul className="people-list">
        {people.map((p) => (
          <li key={p.id} className="person-row">
            <span className="person-name">{p.name}</span>
            <span className="person-kind">{labels.kind[p.kind] ?? p.kind}</span>
            <a className="btn btn-quiet person-connect" href={`/people/${p.id}`}>
              Connect
            </a>
          </li>
        ))}
      </ul>
      <p className="setup-then">
        <b>After this:</b> {first ?? "they"} {first ? "pays" : "pay"} the way they always do. Spotter checks each payment, and anything over the limit or that
        looks like a scam waits at PayPal for you.
      </p>
      <div className="setup-actions setup-footer">
        <a className="btn btn-quiet" href="/setup?step=people">
          Back
        </a>
        <a className="btn btn-primary" href="/dashboard?welcome=setup">
          Go to my dashboard
        </a>
      </div>
    </div>
  );
}
