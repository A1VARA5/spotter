// Telegram webhook. Answers at once (Telegram retries slow webhooks, which would check a payment twice)
// and does the work after the response. The secret header is the only proof a call came from Telegram.
import { after } from "next/server";
import { getDeps } from "@/server/deps";
import { extractPayment } from "@/ai/extract";
import { answerCallback, downloadFile, secretOk, sendHtml, tg } from "@/telegram/api";
import { handleTelegramUpdate, type TgUpdate } from "@/telegram/inbound";
import { MAX_PHOTO_BYTES, photoCheck } from "@/market/photo";
import { pictureDeps, photoDeps } from "@/server/photo";
import { routePicture } from "@/core/picture";

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
      const deps = await getDeps();
      const outcome = await handleTelegramUpdate(
        {
          deps,
          site,
          extract: (t) => extractPayment(t),
          send: sendHtml,
          answer: answerCallback,
          // Photo price check: the photo is downloaded into memory, checked, and dropped. Off without a Channel3 key.
          ...(process.env.CHANNEL3_API_KEY
            ? {
                download: (fileId: string) => downloadFile(fileId, MAX_PHOTO_BYTES),
                photoCheck: ({ householdId, input }) => photoCheck(photoDeps(deps.db, householdId), input),
              }
            : {}),
          // Read screenshots: Claude vision copies out the words, then the normal check runs on them.
          ...(process.env.ANTHROPIC_API_KEY
            ? { readPicture: ({ householdId, bytes, type, choice }) => routePicture(pictureDeps(deps.db, householdId), bytes, type, choice) }
            : {}),
        },
        update,
      );
      console.log(`[spotter] telegram update ${update.update_id}: ${outcome}`);
    } catch (e) {
      console.error("[spotter] telegram update crashed:", e instanceof Error ? e.message : e);
    }
  });
  return new Response("ok");
}
