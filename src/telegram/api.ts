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

const FILE_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

/**
 * Downloads a file the bot was sent (getFile, then Telegram's file host), kept in memory only. Null when Telegram
 * says no, the path looks wrong, or the file is over maxBytes. The file URL carries the token, so it is never logged.
 */
export async function downloadFile(fileId: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const r = await tg("getFile", { file_id: fileId });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: unknown; file_size?: unknown } } | null;
    const path = j?.result?.file_path;
    if (!r.ok || !j?.ok || typeof path !== "string" || !FILE_PATH.test(path) || path.includes("..")) {
      console.error(`[spotter] telegram getFile gave no usable file (${r.status})`);
      return null;
    }
    const size = j.result?.file_size;
    if (typeof size === "number" && size > maxBytes) {
      console.error(`[spotter] telegram file is ${size} bytes, over the ${maxBytes} limit, so it isn't downloaded`);
      return null;
    }
    const f = await fetch(`${API}/file/bot${process.env.TELEGRAM_BOT_TOKEN ?? ""}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!f.ok) {
      console.error(`[spotter] telegram file download failed (${f.status})`);
      return null;
    }
    if (Number(f.headers.get("content-length") ?? 0) > maxBytes) {
      console.error("[spotter] telegram file is over the size limit, so it isn't read");
      return null;
    }
    const bytes = Buffer.from(await f.arrayBuffer());
    if (bytes.length > maxBytes) {
      console.error("[spotter] telegram file is over the size limit, so it isn't used");
      return null;
    }
    return bytes;
  } catch (e) {
    console.error("[spotter] telegram file download error:", e instanceof Error ? e.name : "unknown");
    return null;
  }
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
