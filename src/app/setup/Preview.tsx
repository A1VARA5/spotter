// The right half of setup: a phone showing what the step you're on sets up, built from what you've typed so far.
// name: how your name reaches the person paying. pin: the pad that only your PIN opens. people: the list forming and
// the alert their new rule would send you. connect: that alert arriving on the channel you picked.
import { Iphone, IosActions, IosNotification, LockScreen, SCAM } from "@/app/landing/Devices";
import { BrandMark } from "@/ui/components";
import type { HouseholdKind } from "@/core/households";
import type { Labels } from "@/ui/labels";
import { money } from "@/ui/format";
import { ON_HOLD } from "@/ui/labels";
import type { SetupStep } from "./Setup";
import { alertFor, meName, payerFor } from "./preview-copy";
import "./preview.css";

export type Channel = "telegram" | "discord" | "email";
export type Draft = {
  name: string;
  kind: HouseholdKind;
  pinLength: number;
  /** The person being added on the people step, with the rule as typed (pence). */
  person: { label: string; name: string; agent: boolean; weekly?: number; askAbove?: number } | null;
  channel: Channel;
};
type Person = { name: string; kind: string };

const ARRIVES: Record<Channel, string> = { telegram: "on Telegram", discord: "on Discord", email: "by email" };

/** The made up case every preview uses, so the steps tell one story. */
function story(kind: HouseholdKind) {
  return kind === "business"
    ? { amount: "£420", payee: "Harbourline Packaging", why: "The invoice says their bank details changed." }
    : { amount: "£250", payee: "jamie.k1994@inbox.example", why: "A new number asked for Friends and Family." };
}

export function Preview({ step, draft, people, labels, connected }: { step: SetupStep; draft: Draft; people: Person[]; labels: Labels; connected: Channel[] }) {
  const me = meName(draft.name);
  const payer = payerFor({ draftName: "", people, kind: draft.kind, avoid: me });
  const caption: Record<SetupStep, string> = {
    name: me === "you" ? `What ${payer} sees when a payment waits. Your name tells them who's looking.` : `What ${payer} sees when a payment waits: ${me} is looking.`,
    pin: "Only this PIN approves a payment. Not an AI agent, and not someone with your laptop.",
    people: draft.person
      ? `When ${draft.person.name.trim() || "they"} ${draft.person.name.trim() ? "goes" : "go"} over the limit, the money waits at PayPal and you get this.`
      : `Pick who you look out for, and their alert appears here.`,
    connect: connected.includes(draft.channel)
      ? `A held payment, arriving ${ARRIVES[draft.channel]}.`
      : `A held payment, arriving ${ARRIVES[draft.channel]} once you connect it.`,
  };
  return (
    <aside className="setup-preview" aria-label="Preview of this step">
      {/* On phones only part of the device shows: the end of a chat, or the top of a lock screen or email. */}
      <div className="pv-stage" data-step={step} data-anchor={step === "name" || (step === "connect" && draft.channel !== "email") ? "end" : "start"}>
        {step === "people" && <FamilyCard draft={draft} people={people} labels={labels} me={me} />}
        <Iphone dark={step === "pin" || step === "people" || (step === "connect" && draft.channel === "discord")} scale={0.7} className="preview-phone">
          {step === "name" && <NameScreen draft={draft} payer={payer} me={me} />}
          {step === "pin" && <PinScreen draft={draft} />}
          {step === "people" && <PeopleScreen draft={draft} people={people} />}
          {step === "connect" && <AlertScreen draft={draft} payer={payer} />}
        </Iphone>
      </div>
      <p className="setup-preview-cap" aria-live="polite">
        {caption[step]}
      </p>
    </aside>
  );
}

function ChatBar({ sub }: { sub: string }) {
  return (
    <div className="tg-bar">
      <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true">
        <path d="M10 2 2 10l8 8" stroke="#0a84ff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="tg-av">
        <BrandMark />
      </span>
      <span className="tg-who">
        <b>Spotter</b>
        <i>{sub}</i>
      </span>
    </div>
  );
}

/** Step 1: the person paying asks Spotter, and the reply names you. */
function NameScreen({ draft, payer, me }: { draft: Draft; payer: string; me: string }) {
  const s = story(draft.kind);
  const who = me === "you" ? "your spotter" : me;
  return (
    <div className="tg">
      <ChatBar sub="bot" />
      <div className="tg-chat">
        {draft.kind === "business" ? (
          <div className="tg-msg tg-me tg-fwd">
            <span className="tg-fwd-from">Forwarded from accounts@harbourline-packaging.example</span>
            <span>Invoice HP-4471 is overdue. Please note our bank details have changed. Pay {s.amount} today by bank transfer to avoid a late fee.</span>
            <i>09:35</i>
          </div>
        ) : (
          <div className="tg-msg tg-me tg-fwd">
            <span className="tg-fwd-from">Forwarded from {SCAM.number}</span>
            <span>{SCAM.chat[3].text}</span>
            <span className="tg-mail">{SCAM.chat[4].text}</span>
            <i>09:35</i>
          </div>
        )}
        <div className="tg-msg tg-me">
          <span>{draft.kind === "business" ? `Shall I pay this one?` : `Is this alright to pay? It's from James`}</span>
          <i>09:36</i>
        </div>
        <div className="tg-msg tg-bot">
          <span>
            <b>On hold, nothing has left your account.</b> {s.amount} to {s.payee} is waiting for <b className="pv-live">{who}</b>
            {draft.kind === "business" ? ", the approver" : ""}. {s.why}
          </span>
          <i>09:36</i>
        </div>
        <div className="tg-msg tg-bot">
          <span>
            You&apos;ll hear back here as soon as <span className="pv-live">{who}</span> decides.
          </span>
          <i>09:36</i>
        </div>
      </div>
      <p className="pv-whose" aria-hidden="true">
        {payer}&apos;s phone
      </p>
    </div>
  );
}

/** Step 2: the approve pad, filling in as the PIN is typed. Never shows the digits. */
function PinScreen({ draft }: { draft: Draft }) {
  const s = story(draft.kind);
  const slots = Math.max(4, draft.pinLength);
  return (
    <LockScreen>
      <div className="pinpad" aria-hidden="true">
        <p className="pinpad-title">
          Approve {s.amount} to {draft.kind === "business" ? s.payee : "James"}?
        </p>
        <p className="pinpad-sub">Enter your Spotter PIN</p>
        <p className="pinpad-dots">
          {Array.from({ length: slots }, (_, i) => (
            <i key={i} data-on={i < draft.pinLength || undefined} />
          ))}
        </p>
        <div className="pinpad-keys">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""].map((k, i) => (
            <span key={i} data-blank={k === "" || undefined}>
              {k}
            </span>
          ))}
        </div>
      </div>
    </LockScreen>
  );
}

/** Step 3: the alert the rule being typed would send. */
function PeopleScreen({ draft, people }: { draft: Draft; people: Person[] }) {
  const p = draft.person;
  const who = p?.name.trim() || payerFor({ draftName: "", people, kind: draft.kind, avoid: meName(draft.name) });
  const a = alertFor({ who, askAbove: p ? p.askAbove : undefined });
  // Nobody picked or added yet: the alert is only a sketch of what's coming, so it's dimmed.
  const sketch = !p && people.length === 0;
  return (
    <LockScreen>
      <div className="pv-alert" data-sketch={sketch || undefined}>
        <IosNotification title={a.title} body={a.body} />
        <IosActions items={[{ label: "Deny", tone: "danger" }, { label: "Review with PIN" }]} />
      </div>
    </LockScreen>
  );
}

/** Step 3, beside the phone: the list of people forming, the one being added marked. */
function FamilyCard({ draft, people, labels, me }: { draft: Draft; people: Person[]; labels: Labels; me: string }) {
  const p = draft.person;
  const business = draft.kind === "business";
  return (
    <div className="pv-family" aria-hidden="true">
      <p className="pv-family-title">{me === "you" ? (business ? "Who pays for you" : "Who you look out for") : business ? `Who pays for ${me}` : `${me} looks out for`}</p>
      <ul>
        {people.map((x) => (
          <li key={x.name + x.kind}>
            <span className="pv-av">{x.name.slice(0, 1).toUpperCase()}</span>
            <span className="pv-name">{x.name}</span>
            <span className="pv-kind">{labels.kind[x.kind] ?? x.kind}</span>
          </li>
        ))}
        {p && (
          <li data-new="true">
            <span className="pv-av">{(p.name.trim() || "?").slice(0, 1).toUpperCase()}</span>
            <span className="pv-name">{p.name.trim() || "New person"}</span>
            <span className="pv-kind">
              {p.askAbove !== undefined ? `Asks you above ${money(p.askAbove, "GBP").replace(/\.00$/, "")}` : p.label}
              {p.weekly !== undefined ? `, ${money(p.weekly, "GBP").replace(/\.00$/, "")} a week` : ""}
            </span>
          </li>
        )}
        {people.length === 0 && !p && <li className="pv-empty">Nobody yet</li>}
      </ul>
    </div>
  );
}

/** Step 4: the held payment arriving on the channel picked. */
function AlertScreen({ draft, payer }: { draft: Draft; payer: string }) {
  const s = story(draft.kind);
  const title = `${payer} wants to pay ${s.amount}`;
  const body = `To ${s.payee}, a first time payee. ${s.why} The money is ${ON_HOLD}.`;
  if (draft.channel === "email") {
    return (
      <div className="pv-mail">
        <p className="pv-mail-bar">
          <span>Inbox</span>
        </p>
        <div className="pv-mail-head">
          <span className="pv-mail-av">
            <BrandMark />
          </span>
          <span>
            <b>Spotter</b>
            <i>to me, 09:36</i>
          </span>
        </div>
        <p className="pv-mail-subj">{title}: on hold</p>
        <p className="pv-mail-chip">Waiting for you</p>
        <p className="pv-mail-body">{body}</p>
        <p className="pv-mail-btn">Review and decide</p>
      </div>
    );
  }
  if (draft.channel === "discord") {
    return (
      <div className="pv-dc">
        <div className="pv-dc-bar">
          <span className="tg-av">
            <BrandMark />
          </span>
          <b>Spotter</b>
          <span className="pv-dc-app">APP</span>
        </div>
        <div className="pv-dc-msg">
          <span className="pv-dc-av">
            <BrandMark />
          </span>
          <div>
            <p className="pv-dc-who">
              <b>Spotter</b> <i>Today at 09:36</i>
            </p>
            <div className="pv-dc-embed">
              <p className="pv-dc-title">{title}</p>
              <p>{body}</p>
            </div>
            <p className="pv-dc-btns">
              <span data-tone="danger">Deny</span>
              <span>Review with PIN</span>
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="tg">
      <ChatBar sub="bot" />
      <div className="tg-chat">
        <div className="tg-msg tg-bot">
          <span>Connected. When a payment needs you, it lands here with what Spotter found.</span>
          <i>Mon 18:02</i>
        </div>
        <div className="tg-msg tg-bot">
          <span>
            <b>{title}</b>
            <br />
            {body}
          </span>
          <i>09:36</i>
        </div>
        <p className="pv-tg-keys">
          <span>Deny</span>
          <span>Review with PIN</span>
        </p>
      </div>
    </div>
  );
}
