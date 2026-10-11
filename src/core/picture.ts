// One way in for pictures. A screenshot of a message is read (Claude vision, words only) and then checked like pasted
// text; a photo of things, a quote or an ad goes to the photo price check; when it isn't clear, the person is asked
// once. Reading costs a model call, so it is capped per family and per day (vision_checks). Pictures are never kept:
// a question waiting for an answer remembers only Telegram's file id, for an hour.
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import type { ImageType, ScreenshotRead } from "@/ai/screenshot";

export type PictureChoice = "message" | "prices";
export type PictureRoute =
  | { route: "message"; read: Extract<ScreenshotRead, { ok: true }> }
  | { route: "prices" }
  | { route: "ask" }
  | { route: "error"; status: 429 | 502 | 422; error: string };

export type PictureDeps = {
  db: Db;
  householdId: string;
  read: (bytes: Buffer, type: ImageType) => Promise<ScreenshotRead>;
  perHousehold?: number;
  overall?: number;
};

const PENDING_MINUTES = 60;

/** Takes one of today's reading slots in one statement, or says there are none left. */
async function takeSlot(deps: PictureDeps): Promise<boolean> {
  const took = await deps.db.query(
    `insert into vision_checks (household_id) select $1
     where (select count(*) from vision_checks where at > now() - interval '1 day') < $2
       and (select count(*) from vision_checks where household_id = $1 and at > now() - interval '1 day') < $3
     returning 1`,
    [deps.householdId, deps.overall ?? 200, deps.perHousehold ?? 10],
  );
  return took.length > 0;
}

/**
 * Where a picture goes. "prices" never reads the picture (no model call). Otherwise one read decides: a message is
 * checked, things are priced, and anything else asks the person.
 */
export async function routePicture(deps: PictureDeps, bytes: Buffer, type: ImageType, choice: PictureChoice | null): Promise<PictureRoute> {
  if (choice === "prices") return { route: "prices" };
  if (!(await takeSlot(deps))) {
    console.error(`[spotter] screenshot read skipped for ${deps.householdId}: daily cap reached`);
    return { route: "error", status: 429, error: "Spotter has read all the screenshots it can today. Copy the words and send them instead, or try tomorrow." };
  }
  const read = await deps.read(bytes, type);
  if (!read.ok) return { route: "error", status: 502, error: "Spotter couldn't read that picture just now. Nothing was paid. Copy the words and send them instead, or try again in a few minutes." };
  if (choice === "message") {
    return read.text.length >= 3 ? { route: "message", read } : { route: "error", status: 422, error: "Spotter couldn't find any words in that picture. Nothing was paid." };
  }
  if (read.kind === "message") return { route: "message", read };
  if (read.kind === "products") return { route: "prices" };
  return { route: "ask" };
}

/** The words of a screenshot as the text a check reads, saying plainly where they came from. */
export function screenshotText(read: Extract<ScreenshotRead, { ok: true }>): string {
  return [
    "[Read from a screenshot by Spotter. The words below were copied out of a picture.]",
    read.from ? `[It appears to be from: ${read.from}]` : "",
    read.injection ? "[The screenshot reader noticed words in the picture that try to instruct an AI.]" : "",
    "",
    read.text,
  ]
    .filter((l, i) => l || i === 3)
    .join("\n");
}

// ---------- a question waiting for an answer (Telegram) ----------

export type PendingPicture = { householdId: string; chat: string; fileId: string; caption: string };

export async function savePending(db: Db, p: PendingPicture): Promise<string> {
  const token = randomBytes(12).toString("hex");
  await db.query("insert into pending_pictures (token, household_id, chat, file_id, caption) values ($1, $2, $3, $4, $5)", [token, p.householdId, p.chat, p.fileId, p.caption.slice(0, 1000)]);
  return token;
}

/** The waiting picture, once: only for the chat it was sent in, and only within the hour. */
export async function takePending(db: Db, token: string, chat: string): Promise<PendingPicture | null> {
  if (!/^[a-f0-9]{24}$/.test(token)) return null;
  const rows = await db.query<{ household_id: string; chat: string; file_id: string; caption: string }>(
    `delete from pending_pictures where token = $1 and chat = $2 and created_at > now() - interval '${PENDING_MINUTES} minutes'
     returning household_id, chat, file_id, caption`,
    [token, chat],
  );
  const r = rows[0];
  return r ? { householdId: r.household_id, chat: r.chat, fileId: r.file_id, caption: r.caption } : null;
}
