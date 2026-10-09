// The right half of setup: a phone showing what the step you're on will feel like in real life.
import { Iphone } from "@/app/landing/Devices";
import { BrandMark } from "@/ui/components";
import type { SetupStep } from "./Setup";

type Person = { name: string; kind: string };

function Notification({ title, body }: { title: string; body: string }) {
  return (
    <div className="notif notif-static">
      <div className="notif-top">
        <span className="notif-app">
          <BrandMark />
        </span>
        <span className="notif-name">Spotter</span>
        <span className="notif-when">now</span>
      </div>
      <p className="notif-title">{title}</p>
      <p className="notif-body">{body}</p>
      <div className="notif-actions">
        <span>Deny</span>
        <span>Approve</span>
      </div>
    </div>
  );
}

export function Preview({ step, spotterName, people }: { step: SetupStep; spotterName: string; people: Person[] }) {
  const me = spotterName && spotterName !== "You" ? spotterName : "you";
  const someone = people.find((p) => p.kind !== "agent")?.name ?? people[0]?.name ?? "Gran";
  const caption: Record<SetupStep, string> = {
    name: `This is how ${me === "you" ? "you'll" : `${me} will`} hear about a payment that needs a look.`,
    pin: "Approving needs your PIN, so an AI agent or anyone with your phone can't say yes for you.",
    people: `When ${someone} tries something bigger than you set, it waits for you.`,
    connect: "Once connected, they forward the email or tap pay as usual. Spotter does the rest.",
  };
  return (
    <aside className="setup-preview" aria-label="Preview">
      <Iphone dark className="preview-phone">
        <div className="lock">
          <p className="lock-date">Thursday 12 November</p>
          <p className="lock-time num">9:41</p>
          {step === "pin" ? (
            <div className="pinpad" aria-hidden="true">
              <p className="pinpad-title">Enter your Spotter PIN</p>
              <p className="pinpad-dots">
                <i data-on="true" />
                <i data-on="true" />
                <i />
                <i />
              </p>
              <div className="pinpad-keys">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""].map((k, i) => (
                  <span key={i} data-blank={k === "" || undefined}>
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ) : step === "connect" ? (
            <div className="mail-mini">
              <p className="mail-mini-from">Spotter</p>
              <p className="mail-mini-subj">Re: Fwd: Your parcel is waiting</p>
              <p className="mail-mini-body">Held, not paid. £2.99 to RM Parcel Services is on hold until {me === "you" ? "your spotter" : me} says yes. Why: the link is not a Royal Mail address.</p>
            </div>
          ) : (
            <Notification
              title={step === "people" ? `${someone} wants to pay £60` : "Gran wants to pay £250"}
              body={step === "people" ? `Over the £50 you set, and a first time payee. The money is on hold.` : "A new number asked her for Friends and Family. The money is on hold."}
            />
          )}
        </div>
      </Iphone>
      <p className="setup-preview-cap">{caption[step]}</p>
    </aside>
  );
}
