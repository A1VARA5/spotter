// Talking to the Telegram Bot API. The token only ever lives in the server's environment.
import { timingSafeEqual } from "node:crypto";

const API = "https://api.telegram.org";

export async function tg(method: string, body: object): Promise<Response> {
  return fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN ?? ""}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Sends HTML, and resends as plain text if Telegram refuses the HTML. Throws if both fail, so nothing is lost silently. */
export async function sendHtml(chatId: number | string, html: string, extra: Record<string, unknown> = {}): Promise<void> {
  const text = html.length > 4000 ? html.slice(0, html.lastIndexOf("\n", 4000)) : html;
  let res = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
  if (!res.ok) {
    console.error("[spotter] telegram refused HTML:", res.status, (await res.text()).slice(0, 200));
    res = await tg("sendMessage", { chat_id: chatId, text: plain(text), ...extra });
  }
  if (!res.ok) throw new Error(`Telegram refused the message (${res.status})`);
}

export async function answerCallback(id: string, text: string): Promise<void> {
  const res = await tg("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 190) });
  if (!res.ok) console.error("[spotter] telegram answerCallbackQuery failed:", res.status);
}

/** Telegram signs nothing; the secret we set with setWebhook comes back in this header on every call. */
export function secretOk(req: Request): boolean {
  const want = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (!want || !got) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
