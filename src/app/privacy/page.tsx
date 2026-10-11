import { TopBar } from "@/ui/components";

export const metadata = { title: "Privacy | Spotter" };

export default function Privacy() {
  return (
    <main className="shell legal">
      <TopBar />
      <h1 className="page-title">Privacy</h1>
      <p className="lede">Spotter is a hackathon project running on the PayPal sandbox. No real money moves. Here is exactly what it keeps, and what goes where.</p>
      <h2 className="section-title">What Spotter stores</h2>
      <ul>
        <li>From Log in with PayPal: your PayPal user id, your name and your email. Nothing else, and never your password.</li>
        <li>Your household: your first name, a scrambled version of your PIN (scrypt, never the PIN itself), the people you add and their limits.</li>
        <li>Payment requests and Spotter&apos;s decisions, including the text that was checked, so you can see why something was held.</li>
        <li>For a held or stopped payment, the case file: what each check found, and when a link was opened, a small screenshot of that page and the facts about it (where it ended up, what it asks for).</li>
        <li>For connected people and for you: the email address, Telegram chat or Discord user they paired from. For agents: a scrambled copy of their key.</li>
      </ul>
      <h2 className="section-title">What goes where</h2>
      <ul>
        <li>
          <strong>Anthropic (Claude)</strong>: the text being checked, with the payee and amount, for the scam check and the case file. Watchtower&apos;s assistant also
          uses Claude: it gets your question and the board&apos;s rows (names, amounts, outcomes, Spotter&apos;s reasons), never the scam messages themselves.
        </li>
        <li>
          <strong>KERNEL</strong> (cloud browser): when a held or stopped payment has a link or a shop page, that one address is opened in a throwaway browser that
          KERNEL runs, so nobody in the family has to click it. The browser has no cookies, logins or family data, and it&apos;s deleted after the visit. KERNEL keeps
          a recording of the visit for about a day; Spotter offers it for 23 hours. &quot;Look at it safely&quot; sends only your scrolls to a browser like that.
        </li>
        <li>
          <strong>Channel3</strong> (real shop prices): the product name for price checks and price watches. A photo you check is sent to Channel3 to find the things
          in it; Spotter never stores the photo, only the answer from Channel3. For spot the difference, the shop page&apos;s screenshot is sent to find the same product.
        </li>
        <li>
          <strong>Telegram and Discord</strong>, only if you connect them: alerts (who, how much, to whom, and why) go through them, and messages you forward to the bot
          are checked like an email. Telegram and Discord can see those messages.
        </li>
        <li>
          <strong>PayPal</strong> (sandbox): the payments themselves. PayPal tells Spotter when it holds, pays or releases money. <strong>Agentboxd</strong>: forwarded
          emails arrive through it, and alert emails go out through it.
        </li>
        <li>Only your signed in household sees your data. Other households can&apos;t see or act on it. The Spotter network shares only a scrambled fingerprint of a payee, never names or messages.</li>
      </ul>
      <h2 className="section-title">How long</h2>
      <p>
        Demo families are deleted after 48 hours. To delete your household, leave a comment on Spotter&apos;s Devpost
        project page asking for it, and it is removed within a week. Comments there are public, so leave personal details out.
      </p>
    </main>
  );
}
