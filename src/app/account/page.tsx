import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requirePageSession } from "@/server/page-session";
import { AppShell } from "@/ui/AppShell";
import { Account } from "./Account";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account | Spotter" };

export default async function AccountPage() {
  const db = await getDb();
  const { household, unlocked } = await requirePageSession(db);
  if (!unlocked) redirect("/dashboard?unlock=account");
  return (
    <AppShell db={db} household={household} current="account" layout="narrow">
      <h1 className="page-title">Your account</h1>
      <p className="lede" style={{ margin: "8px 0 8px" }}>
        {household.demo ? "This is a demo family. It's yours alone and is deleted after 48 hours." : "You signed in with PayPal (sandbox)."}
      </p>
      <Account
        spotterName={household.spotter_name}
        alertEmail={household.alert_email}
        inbox={process.env.AGENTBOXD_INBOX_ADDRESS ?? null}
        demo={household.demo}
        telegramBot={process.env.TELEGRAM_BOT_USERNAME ?? null}
        telegramConnected={Boolean(household.telegram_chat_id)}
        discordApp={process.env.DISCORD_BOT_TOKEN ? (process.env.DISCORD_APPLICATION_ID ?? null) : null}
        discordConnected={Boolean(household.discord_user_id)}
      />
    </AppShell>
  );
}
