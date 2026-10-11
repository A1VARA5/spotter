import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { isSignedIn } from "@/server/page-session";

export const metadata = { title: "Terms | Spotter" };
// Reads the session so the shared header says Dashboard to someone signed in.
export const dynamic = "force-dynamic";

export default async function Terms() {
  const signedIn = await isSignedIn();
  return (
    <>
    <PublicHeader band signedIn={signedIn} current="terms" />
    <main className="shell legal">
      <h1 className="page-title">Terms</h1>
      <p className="lede">Spotter is a hackathon project for the PayPal AI Hackathon. Please read this before you use it.</p>
      <ul>
        <li>It runs on the PayPal sandbox only. No real payments are made and no real money moves.</li>
        <li>It is a demonstration, not a financial service. Don't rely on it to protect real money.</li>
        <li>The scam check uses AI and can be wrong in both directions. Spotter is built so that when it isn't sure, it asks you.</li>
        <li>Don't use it to break the law or to test it against people who haven't agreed to it.</li>
        <li>It is provided as is, without any warranty. The code is open source under the MIT licence.</li>
      </ul>
    </main>
    <PublicFooter band />
    </>
  );
}
