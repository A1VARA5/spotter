import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { isSignedIn } from "@/server/page-session";

export const metadata = {
  title: "Before real money | Spotter",
  description: "What would need to be true before Spotter touched real money, and what stays exactly the same.",
};
// Reads the session so the shared header says Dashboard to someone signed in.
export const dynamic = "force-dynamic";

const TODO: Array<[string, string]> = [
  [
    "PayPal live approval and a partner agreement",
    "Holding and releasing other people's money for real needs PayPal to approve the app for live use and a proper agreement about who is responsible for what. I haven't applied for either.",
  ],
  [
    "Vault for agent holds",
    "Today an AI agent's payments use a sandbox test card. A live version would use PayPal Vault, so the person saves their own PayPal once and Spotter can hold a payment for them later without a card number anywhere near my code.",
  ],
  [
    "Key rotation and a secrets manager",
    "Keys live in a git ignored .env.local on my laptop and in Vercel's environment settings. That's fine for a demo. Real money needs a secrets manager, keys that rotate on a schedule, and a written plan for the day one leaks.",
  ],
  [
    "Prompts checked by someone who isn't me",
    "The AI check already quotes its evidence and code throws out anything it can't find in the message. Before real money, the prompts and the test set behind them should be audited by someone outside the project, and rerun every time a model changes.",
  ],
  [
    "Rate limits sized for real traffic",
    "The limits now are sized for a demo: 100 calls per agent key a day, daily caps on paid lookups, and simple per address limits on public pages. Real families would need limits planned from real traffic, kept in one shared place instead of each server's memory.",
  ],
  [
    "A data retention policy",
    "Demo families are deleted after 48 hours. Real households would need a written policy for how long payment requests, case files and screenshots are kept, and a delete button that doesn't involve leaving me a comment.",
  ],
  [
    "A support contact",
    "Right now the only way to reach me is a comment on the Devpost page. Someone whose payment is stuck needs a real address and an answer the same day.",
  ],
  [
    "A security review",
    "I've run my own reviews and fixed what they found, and the threat model is in the repo. That isn't the same as a paid review by people who break payment apps for a living. That comes first.",
  ],
];

const SAME = [
  "No AI moves money. The AI can flag, explain and hold. Only a person says yes.",
  "Every yes needs the spotter's PIN. A forwarded alert, a leaked email or a clever agent can't approve anything.",
  "Gift card and crypto asks are still stopped, and Friends and Family is never sent where it would skip buyer protection.",
  "Money is held at PayPal while you decide, and released if you say no.",
];

export default async function RealMoney() {
  const signedIn = await isSignedIn();
  return (
    <>
      <PublicHeader band signedIn={signedIn} />
      <main className="shell legal realmoney">
        <h1 className="page-title">What would need to be true before real money</h1>
        <p className="lede">
          Spotter only touches the PayPal sandbox, and that&apos;s on purpose. Here&apos;s the honest list of what I&apos;d need before it held anyone&apos;s real money.
        </p>
        <ol className="rm-list">
          {TODO.map(([title, text]) => (
            <li key={title}>
              <h2 className="rm-title">{title}</h2>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <h2 className="section-title">What stays exactly the same</h2>
        <ul>
          {SAME.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p>
          Want to see what&apos;s working right now? The <Link href="/status">status page</Link> checks every part once a minute. How it all fits together is on{" "}
          <Link href="/how">How it works</Link>.
        </p>
      </main>
      <PublicFooter band />
    </>
  );
}
