// Each family's Watchtower, saved: the AG Studio board (exactly what Studio's getState() returned, so its
// version stamp survives and Studio can migrate it later), the incident pages it has already been given,
// and the AI chat threads behind AG's AgAiHistoryStore. Sizes and counts are capped per family.
import type { Db } from "@/db";
import { householdFrom } from "@/server/auth";

export const BOARD_MAX_BYTES = 300_000;
export const THREAD_MAX_BYTES = 200_000;
export const THREADS_PER_FAMILY = 30;
const SEEN_MAX = 200;
const THREAD_ID = /^[A-Za-z0-9_-]{1,100}$/;

type Board = { state: unknown; seen: string[] };

export async function loadBoard(db: Db, householdId: string): Promise<Board | null> {
  const [row] = await db.query<{ state: unknown; seen_incidents: unknown }>("select state, seen_incidents from watchtower_boards where household_id = $1", [householdId]);
  if (!row) return null;
  return { state: row.state, seen: Array.isArray(row.seen_incidents) ? row.seen_incidents.map(String) : [] };
}

/** Saves the board with incident pages added in code, and remembers them so a deleted one stays deleted. */
export async function markIncidentsSeen(db: Db, householdId: string, state: unknown, ids: string[]): Promise<void> {
  const before = (await loadBoard(db, householdId))?.seen ?? [];
  const seen = [...new Set([...before, ...ids])].slice(-SEEN_MAX);
  await db.query(
    `insert into watchtower_boards (household_id, state, seen_incidents) values ($1, $2::jsonb, $3::jsonb)
     on conflict (household_id) do update set state = excluded.state, seen_incidents = excluded.seen_incidents, updated_at = now()`,
    [householdId, JSON.stringify(state), JSON.stringify(seen)],
  );
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const signIn = () => json({ error: "Sign in first." }, 401);

/** Studio's own shape, loosely: an object with at least one page and a selected page id. */
function isBoardState(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as { pages?: unknown; selectedPageId?: unknown };
  return Array.isArray(s.pages) && s.pages.length > 0 && s.pages.every((p) => p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string") && typeof s.selectedPageId === "string";
}

function isThread(v: unknown, id: string): boolean {
  if (!v || typeof v !== "object") return false;
  const t = v as { summary?: { threadId?: unknown; agentId?: unknown; updatedAt?: unknown }; messages?: unknown };
  return t.summary?.threadId === id && typeof t.summary.agentId === "string" && typeof t.summary.updatedAt === "number" && Array.isArray(t.messages);
}

/** Reads a JSON body, refusing it before parsing when it's over the cap. */
async function body(request: Request, max: number): Promise<{ value: unknown } | Response> {
  const text = await request.text().catch(() => null);
  if (text === null) return json({ error: "Couldn't read that." }, 400);
  if (Buffer.byteLength(text) > max) return json({ error: "That's too big to save." }, 413);
  try {
    return { value: JSON.parse(text) };
  } catch {
    return json({ error: "That wasn't JSON." }, 400);
  }
}

export function makeWatchtowerStore(db: Db, opts: { maxBoardBytes?: number; maxThreadBytes?: number } = {}) {
  const maxBoard = opts.maxBoardBytes ?? BOARD_MAX_BYTES;
  const maxThread = opts.maxThreadBytes ?? THREAD_MAX_BYTES;
  return {
    async putBoard(request: Request): Promise<Response> {
      const hh = householdFrom(request);
      if (!hh) return signIn();
      const b = await body(request, maxBoard + 100);
      if (b instanceof Response) return b;
      const state = (b.value as { state?: unknown } | null)?.state;
      if (!isBoardState(state)) return json({ error: "That isn't a Watchtower board." }, 400);
      const text = JSON.stringify(state);
      if (Buffer.byteLength(text) > maxBoard) return json({ error: "This board is too big to save. Remove a page or two." }, 413);
      await db.query(
        `insert into watchtower_boards (household_id, state) values ($1, $2::jsonb)
         on conflict (household_id) do update set state = excluded.state, updated_at = now()`,
        [hh, text],
      );
      return json({ ok: true });
    },

    async listThreads(request: Request): Promise<Response> {
      const hh = householdFrom(request);
      if (!hh) return signIn();
      const rows = await db.query<{ summary: unknown }>(
        `select data->'summary' as summary from watchtower_threads where household_id = $1
         order by (data->'summary'->>'updatedAt')::float8, updated_at`,
        [hh],
      );
      return json({ threads: rows.map((r) => r.summary) });
    },

    async getThread(request: Request, id: string): Promise<Response> {
      const hh = householdFrom(request);
      if (!hh) return signIn();
      const [row] = await db.query<{ data: unknown }>("select data from watchtower_threads where household_id = $1 and id = $2", [hh, id]);
      return row ? json({ thread: row.data }) : json({ error: "No such chat." }, 404);
    },

    async putThread(request: Request, id: string): Promise<Response> {
      const hh = householdFrom(request);
      if (!hh) return signIn();
      if (!THREAD_ID.test(id)) return json({ error: "That isn't a chat id." }, 400);
      const b = await body(request, maxThread);
      if (b instanceof Response) return b;
      if (!isThread(b.value, id)) return json({ error: "That isn't a chat." }, 400);
      await db.query(
        `insert into watchtower_threads (id, household_id, data) values ($1, $2, $3::jsonb)
         on conflict (household_id, id) do update set data = excluded.data, updated_at = now()`,
        [id, hh, JSON.stringify(b.value)],
      );
      // Over the cap, the chats nobody has touched for longest go first.
      await db.query(
        `delete from watchtower_threads where household_id = $1 and id in (
           select id from watchtower_threads where household_id = $1
           order by (data->'summary'->>'updatedAt')::float8 desc, updated_at desc offset $2)`,
        [hh, THREADS_PER_FAMILY],
      );
      return json({ ok: true });
    },

    async deleteThread(request: Request, id: string): Promise<Response> {
      const hh = householdFrom(request);
      if (!hh) return signIn();
      await db.query("delete from watchtower_threads where household_id = $1 and id = $2", [hh, id]);
      return json({ ok: true });
    },
  };
}
