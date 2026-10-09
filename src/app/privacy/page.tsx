import { TopBar } from "@/ui/components";

export const metadata = { title: "Privacy | Spotter" };

export default function Privacy() {
  return (
    <main className="shell legal">
      <TopBar />
      <h1 className="page-title">Privacy</h1>
      <p className="lede">Spotter is a hackathon project running on the PayPal sandbox. No real money moves. Here is exactly what it keeps.</p>
      <h2 className="section-title">What Spotter stores</h2>
      <ul>
        <li>From Log in with PayPal: your PayPal user id, your name and your email. Nothing else, and never your password.</li>
        <li>Your household: your first name, a scrambled version of your PIN (scrypt, never the PIN itself), the people you add and their limits.</li>
        <li>Payment requests and Spotter's decisions, including the text that was checked, so you can see why something was held.</li>
        <li>For connected people: the email address or Telegram chat they paired from. For agents: a scrambled copy of their key.</li>
      </ul>
      <h2 className="section-title">Who sees it</h2>
      <ul>
        <li>Only your signed in household. Other households can't see or act on your data.</li>
        <li>Text being checked is sent to Anthropic (Claude) for the scam check, to Channel3 for price checks (product name only), and payments go to the PayPal sandbox. Forwarded emails arrive through Agentboxd.</li>
      </ul>
      <h2 className="section-title">How long</h2>
      <p>Demo families are deleted after 48 hours. To delete your household, email the address on the project page and it is removed within a week.</p>
    </main>
  );
}
