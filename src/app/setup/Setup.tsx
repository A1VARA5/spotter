"use client";
// First run setup. One question per screen; the server decides where to resume, so leaving halfway is fine.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, BriefcaseBusiness, HeartHandshake, House, Smile, Store, X } from "lucide-react";
import { money } from "@/ui/format";
import { readJson } from "@/ui/http";
import { Confirm } from "@/ui/Confirm";
import { labelsFor, type Labels } from "@/ui/labels";
import type { HouseholdKind } from "@/core/households";

export type SetupStep = "name" | "pin" | "people" | "connect";
type Person = { id: string; name: string; kind: string };
type PresetView = { key: string; label: string; hint: string; weekly: number; askAbove: number };

const ORDER: SetupStep[] = ["name", "pin", "people", "connect"];
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

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
  return j;
}

export function Setup(props: { step: SetupStep; spotterName: string; pinSet: boolean; people: Person[]; presets: PresetView[]; kind: HouseholdKind }) {
  const labels = labelsFor(props.kind);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [props.step]);
  const n = ORDER.indexOf(props.step) + 1;
  return (
    <section className="setup" aria-labelledby="setup-q">
      <p className="setup-progress">
        Step {n} of {ORDER.length}
      </p>
      <ol className="setup-dots" aria-hidden="true">
        {ORDER.map((s, i) => (
          <li key={s} data-done={i < n - 1} data-now={i === n - 1} />
        ))}
      </ol>
      {props.step === "name" && <NameStep {...props} heading={heading} />}
      {props.step === "pin" && <PinStep heading={heading} />}
      {props.step === "people" && <PeopleStep {...props} labels={labels} heading={heading} />}
      {props.step === "connect" && <ConnectStep {...props} labels={labels} heading={heading} />}
    </section>
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

function NameStep({ heading, spotterName, pinSet, kind: savedKind }: H & { spotterName: string; pinSet: boolean; kind: HouseholdKind }) {
  const [name, setName] = useState(spotterName === "You" ? "" : spotterName);
  const [kind, setKind] = useState<HouseholdKind>(savedKind);

  const { busy, error, run } = useSubmit();
  return (
    <form className="setup-form" onSubmit={(e) => (e.preventDefault(), run(() => post("/api/setup/name", { spotterName: name, kind }), pinSet ? "people" : "pin"))}>
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
        onChange={(e) => setName(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "name-error" : undefined}
        required
      />
      <fieldset className="preset-group kind-group">
        <legend className="field-label">Spotter is for</legend>
        {HOUSEHOLD_CHOICES.map((c) => (
          <label key={c.kind} className="preset" data-checked={kind === c.kind}>
            <input type="radio" name="household-kind" value={c.kind} checked={kind === c.kind} onChange={() => setKind(c.kind)} className="sr-only" />
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
      </div>
    </form>
  );
}

function PinStep({ heading }: H) {
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
        onChange={(e) => setPin(digits(e.target.value))}
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
      </div>
    </form>
  );
}

function PeopleStep({ heading, people, presets, labels }: H & { people: Person[]; presets: PresetView[]; labels: Labels }) {
  const [preset, setPreset] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [weekly, setWeekly] = useState("");
  const [askAbove, setAskAbove] = useState("");
  const add = useSubmit();
  const remove = useSubmit();
  const chosen = presets.find((p) => p.key === preset);
  const pence = (v: string) => (v.trim() === "" ? undefined : Math.round(Number(v) * 100));

  function choose(key: string) {
    const p = presets.find((x) => x.key === key)!;
    setPreset(key);
    setWeekly(String(p.weekly / 100));
    setAskAbove(String(p.askAbove / 100));
    if (p.key === "agent" || p.key === "buyer") {
      if (!name) setName(labels.agentName);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await add.run(() => post("/api/spenders", { name, preset, weeklyPence: pence(weekly), askAbovePence: pence(askAbove) }));
    setPreset(null);
    setName("");
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
            <input id="person-name" className="field" autoFocus value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} required />
            <div className="money-pair">
              <div>
                <label className="field-label" htmlFor="weekly">
                  Weekly limit (£)
                </label>
                <input id="weekly" className="field num" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
              <div>
                <label className="field-label" htmlFor="ask-above">
                  Ask me above (£)
                </label>
                <input id="ask-above" className="field num" inputMode="decimal" value={askAbove} onChange={(e) => setAskAbove(e.target.value.replace(/[^\d.]/g, ""))} />
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
          <a className="btn btn-primary" href="/setup?step=connect">
            Continue
          </a>
        ) : (
          <a className="setup-skip" href="/dashboard">
            I'll do this later
          </a>
        )}
      </div>
    </div>
  );
}

function ConnectStep({ heading, people, labels }: H & { people: Person[]; labels: Labels }) {
  return (
    <div className="setup-form">
      <Question heading={heading} sub="Each person connects once, from their own phone, email or agent. You can do this now or any time from their page.">
        Connect them
      </Question>
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
