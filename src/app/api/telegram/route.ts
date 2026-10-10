// Telegram webhook. Answers at once (Telegram retries slow webhooks, which would check a payment twice)
// and does the work after the response. The secret header is the only proof a call came from Telegram.
import { after } from "next/server";
import { getDeps } from "@/server/deps";
import { extractPayment } from "@/ai/extract";
import { answerCallback, secretOk, sendHtml, tg } from "@/telegram/api";
import { handleTelegramUpdate, type TgUpdate } from "@/telegram/inbound";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!secretOk(req)) return new Response("unauthorised", { status: 401 });
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update || typeof update.update_id !== "number") return new Response("ok");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

  after(async () => {
    try {
      const chat = update.message?.chat.id;
      if (chat && update.message?.chat.type === "private") await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
      const outcome = await handleTelegramUpdate(
        { deps: await getDeps(), site, extract: (t) => extractPayment(t), send: sendHtml, answer: answerCallback },
        update,
      );
      console.log(`[spotter] telegram update ${update.update_id}: ${outcome}`);
    } catch (e) {
      console.error("[spotter] telegram update crashed:", e instanceof Error ? e.message : e);
    }
  });
  return new Response("ok");
}
