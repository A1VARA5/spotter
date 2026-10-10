// The Telegram Login Widget lands here. The signed in, unlocked spotter connects their own Telegram for alerts.
// With "request access to write" the bot may message them; their user id is also their private chat id.
import { getDeps } from "@/server/deps";
import { requireSpotter } from "@/server/auth";
import { verifyTelegramLogin } from "@/telegram/login";
import { sendHtml } from "@/telegram/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const s = requireSpotter(request);
  if (s instanceof Response) return Response.redirect(`${url.origin}/dashboard?unlock=account`, 303);
  const user = verifyTelegramLogin(url.searchParams, process.env.TELEGRAM_BOT_TOKEN ?? "");
  if (!user) {
    console.warn("[spotter] telegram login refused: bad or stale signature");
    return Response.redirect(`${url.origin}/account?telegram=failed`, 303);
  }
  const { db } = await getDeps();
  await db.query("update households set telegram_chat_id = $2 where id = $1", [s.householdId, user.id]);
  await sendHtml(user.id, "<b>You're connected.</b> When someone's payment needs you, Spotter tells you here, with a button to deny it straight away.").catch((e) =>
    console.error("[spotter] telegram welcome failed:", e instanceof Error ? e.message : e),
  );
  return Response.redirect(`${url.origin}/account?telegram=connected`, 303);
}
