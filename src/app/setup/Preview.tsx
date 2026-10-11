// The right half of setup: a phone showing what the step you're on will feel like in real life.
import { Iphone, IosActions, IosNotification, LockScreen } from "@/app/landing/Devices";
import type { SetupStep } from "./Setup";
import type { HouseholdKind } from "@/core/households";
import { ON_HOLD } from "@/ui/labels";

type Person = { name: string; kind: string };

export function Preview({ step, spotterName, people, kind = "family" }: { step: SetupStep; spotterName: string; people: Person[]; kind?: HouseholdKind }) {
  const me = spotterName && spotterName !== "You" ? spotterName : "you";
  const biz = kind === "business";
  const someone = people.find((p) => p.kind !== "agent")?.name ?? people[0]?.name ?? (biz ? "Tom" : "Gran");
  const caption: Record<SetupStep, string> = {
    name: `This is how ${me === "you" ? "you'll" : `${me} will`} hear about a payment that needs a look. Telegram and Discord alerts can deny it on the spot; approving always needs your PIN on the dashboard.`,
    pin: "Approving needs your PIN, so an AI agent or anyone with your phone can't say yes for you.",
    people: biz ? `When ${someone} pays a new supplier or more than you set, it waits for you.` : `When ${someone} tries something bigger than you set, it waits for you.`,
    connect: biz ? "Once connected, they forward the invoice or the agent pays as usual. Spotter does the rest." : "Once connected, they forward the email or tap pay as usual. Spotter does the rest.",
  };
  return (
    <aside className="setup-preview" aria-label="Preview">
      <Iphone dark scale={0.7} className="preview-phone">
        <LockScreen>
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
              <p className="mail-mini-subj">{biz ? "Re: Fwd: Invoice HP-4471 overdue" : "Re: Fwd: Your parcel is waiting"}</p>
              <p className="mail-mini-body">
                {biz
                  ? "Not sent. The invoice from Harbourline Packaging says the bank details changed and asks for a bank transfer. Ring them on a number you already have, then pay through PayPal."
                  : `Waiting for ${me === "you" ? "your spotter" : me}, not paid. £1.99 to Larkhill Parcels is ${ON_HOLD}. Why: the link is not the delivery company's real address.`}
              </p>
            </div>
          ) : (
            <>
              <IosNotification
                title={biz ? (step === "people" ? `${someone} wants to pay £420` : "Tom wants to pay £286.40") : step === "people" ? `${someone} wants to pay £60` : "Gran wants to pay £250"}
                body={
                  biz
                    ? step === "people"
                      ? "Over the £250 you set, and a supplier you haven't paid before. The money is on hold."
                      : "A supplier email says their bank details changed. The money is on hold."
                    : step === "people"
                      ? "Over the £50 you set, and a first time payee. The money is on hold."
                      : "A new number asked her for Friends and Family. The money is on hold."
                }
              />
              {/* Same as the real alerts: Deny works from the phone, approving needs the PIN on the dashboard. */}
              <IosActions items={[{ label: "Deny", tone: "danger" }, { label: "Review with PIN" }]} />
            </>
          )}
        </LockScreen>
      </Iphone>
      <p className="setup-preview-cap">{caption[step]}</p>
    </aside>
  );
}
