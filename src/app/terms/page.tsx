import { TopBar } from "@/ui/components";

export const metadata = { title: "Terms | Spotter" };

export default function Terms() {
  return (
    <main className="shell legal">
      <TopBar />
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
  );
}
