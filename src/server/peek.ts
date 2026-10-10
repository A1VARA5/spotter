// "Look at it safely": the spotter looks at the page from a case file themselves, live, without opening it on
// their own phone or laptop. The page runs in a fresh KERNEL cloud browser; this server takes a picture of that
// browser's screen about once a second and relays it, and offers exactly two actions: scroll up and scroll down.
//
// Why a relayed picture and not KERNEL's live view: the live view link is a bearer link (anyone holding it can
// watch, and by dropping ?readOnly=true, control the browser) and it redirects to a page carrying a signed token.
// Relaying keeps every KERNEL link and id on the server, makes "read only" something the server enforces rather
// than a query parameter, and needs no third party frame on our page. Reasoning in docs/kernel-notes.md.
//
// Limits: only the household that owns the payment, only the page already on its case file (and only if that page
// is a link from the payment's own message, on a public address), one open peek per household, 90 seconds, daily
// caps per household and overall. The browser is deleted on close, when its time is up (checked on every call),
// and by KERNEL itself after 20 seconds without a frame being asked for.
import type { Db } from "@/db";
import { getPayment } from "@/core/lifecycle";
import { open as openSealed, seal as sealValue } from "@/core/seal";
import { extractUrls, safeToFetch } from "@/agents/links";

export const PEEK = {
  /** How long one peek lasts. */
  seconds: 90,
  /** KERNEL ends the browser itself after this many seconds without activity (our frame requests count). */
  backstopSeconds: 20,
  perHouseholdDaily: 3,
  globalDaily: 30,
  /** Frames closer together than this are refused (about one a second is asked for). */
  minFrameMs: 400,
};

export type PeekView = "phone" | "desktop";
const VIEWPORT: Record<PeekView, { width: number; height: number }> = {
  desktop: { width: 1024, height: 768 },
  phone: { width: 390, height: 844 },
};

/** The slice of the @onkernel/sdk client this uses, so tests can pass a fake. */
export type PeekKernel = {
  browsers: {
    create(body: {
      headless?: boolean;
      stealth?: boolean;
      timeout_seconds?: number;
      start_url?: string;
      viewport?: { width: number; height: number };
    }): Promise<{ session_id: string }>;
    deleteByID(id: string): Promise<unknown>;
    computer: {
      captureScreenshot(id: string): Promise<Response>;
      scroll(id: string, body: { x: number; y: number; delta_y?: number }): Promise<unknown>;
    };
  };
};

type Opts = {
  kernel?: PeekKernel;
  apiKey?: string;
  /** The same check the link inspector uses: refuses localhost, private and link local addresses. */
  isPublicHost?: (host: string) => Promise<boolean>;
  seal?: (purpose: string, value: string) => string;
  /** How long starting the browser may take (tests shorten it). */
  createMs?: number;
};

export const PEEK_SEAL = "kernel-peek";
const MAX_FRAME_BYTES = 3_000_000;
const CREATE_MS = 12_000;
const CALL_MS = 6_000;

const json = (status: number, data: Record<string, unknown>) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, error: string) => json(status, { error });
// KERNEL's error messages can echo a session id ("browser <id> not found"), so long id like runs are blanked
// before anything is logged.
const msg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e))
    .replace(/[A-Za-z0-9_-]{16,}/g, (s) => (/\d/.test(s) ? "[id]" : s))
    .slice(0, 200);

/** Keeps a clean up promise running after the response is sent (Vercel would freeze it otherwise). */
function keepAlive(p: Promise<unknown>) {
  import("next/server")
    .then(({ after }) => after(p))
    .catch(() => undefined); // outside a request (tests, scripts) the promise simply runs on
}

async function client(opts: Opts): Promise<PeekKernel | null> {
  if (opts.kernel) return opts.kernel;
  const apiKey = opts.apiKey ?? process.env.KERNEL_API_KEY;
  if (!apiKey) return null;
  const { default: Kernel } = await import("@onkernel/sdk");
  // The SDK's own limit is longer than ours, so a browser that is created after we stop waiting still comes back
  // with its id, and gets deleted (see startPeek), instead of the request being cut off with the browser running.
  return new Kernel({ apiKey, maxRetries: 0, timeout: CREATE_MS + 15_000 }) as unknown as PeekKernel;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms)));
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Never throws: a failed delete is logged, and KERNEL's inactivity timeout ends the browser anyway. */
async function deleteBrowser(kernel: PeekKernel, sessionId: string, why: string) {
  try {
    await withTimeout(kernel.browsers.deleteByID(sessionId), CALL_MS, "deleting the browser");
  } catch (e) {
    console.error(`[spotter] peek: deleting the cloud browser (${why}) failed, KERNEL's ${PEEK.backstopSeconds} s inactivity timeout will end it:`, msg(e));
  }
}

function openSession(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return openSealed(PEEK_SEAL, sealed);
  } catch (e) {
    console.error("[spotter] peek: can't open sealed session ids:", msg(e));
    return null;
  }
}

/** Deletes the browsers of peeks that were just closed, all at once. A sealed id that won't open is logged. */
async function deleteAll(kernel: PeekKernel | null, rows: Array<{ session_sealed: string | null }>, why: string) {
  await Promise.allSettled(
    rows.map(async (r) => {
      if (!r.session_sealed) return; // the browser never started, or a start that died: KERNEL's backstop covers it
      const s = openSession(r.session_sealed);
      if (s && kernel) return deleteBrowser(kernel, s, why);
      console.error(`[spotter] peek: a closed peek's browser (${why}) couldn't be deleted (${kernel ? "unreadable id" : "KERNEL not set up"}), KERNEL's inactivity timeout will end it`);
    }),
  );
}

/**
 * Ends every peek that ran past its time (any household) and deletes its browsers. Also ends a start that died half
 * way (no session after 30 s), so the family isn't told "already looking" for the rest of the 90 s.
 */
export async function sweepPeeks(db: Db, kernel: PeekKernel): Promise<number> {
  const rows = await db.query<{ session_sealed: string | null }>(
    `update peeks set closed_at = now(), close_reason = case when session_sealed is null then 'stuck' else 'time' end
     where closed_at is null and (ends_at < now() or (session_sealed is null and started_at < now() - interval '30 seconds'))
     returning session_sealed`,
  );
  await deleteAll(kernel, rows, "time up");
  return rows.length;
}

const canon = (u: string) => {
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
};

/** The page to show: the one on the case file, only if it is a link from the payment's own message, on a public web address. */
async function pageFor(db: Db, householdId: string, paymentId: string, opts: Opts): Promise<{ url: string } | Response> {
  const p = await getPayment(db, paymentId, householdId);
  if (!p) return fail(404, "There's no payment like that in your family.");
  const raw = p.case_file?.page?.url;
  if (!raw) return fail(404, "Spotter didn't open a page for this payment, so there's nothing to look at.");
  const url = canon(raw);
  if (!url) return fail(400, "That page's address can't be read, so it won't be opened.");
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") return fail(400, "Only web pages are opened.");
  const inMessage = new Set(extractUrls(p.request.context ?? "").map(canon).filter(Boolean));
  if (!inMessage.has(url)) return fail(400, "That page isn't a link from this payment's message, so it won't be opened.");
  const isPublic = opts.isPublicHost ?? safeToFetch;
  if (!(await isPublic(u.hostname))) return fail(400, "That link points at a private address, so it won't be opened.");
  return { url };
}

export async function startPeek(db: Db, householdId: string, paymentId: string, view: PeekView, opts: Opts = {}): Promise<Response> {
  if (view !== "phone" && view !== "desktop") return fail(400, "Pick phone or desktop.");
  const kernel = await client(opts);
  if (!kernel) return fail(503, "The cloud browser isn't set up on this server.");
  const page = await pageFor(db, householdId, paymentId, opts);
  if (page instanceof Response) return page;

  await sweepPeeks(db, kernel);
  const id = `peek_${crypto.randomUUID().replace(/-/g, "")}`;
  // One statement: the caps are counted and the open slot is claimed together. The partial unique index is what
  // really keeps it to one open peek per household when two starts race.
  const claimed = await db.query<{ id: string }>(
    `insert into peeks (id, household_id, payment_id, view, ends_at)
     select $1, $2, $3, $4, now() + make_interval(secs => $5)
     where (select count(*) from peeks where household_id = $2 and started_at > now() - interval '1 day' and close_reason is distinct from 'failed') < $6
       and (select count(*) from peeks where started_at > now() - interval '1 day' and close_reason is distinct from 'failed') < $7
     on conflict (household_id) where closed_at is null do nothing
     returning id`,
    [id, householdId, paymentId, view, PEEK.seconds, PEEK.perHouseholdDaily, PEEK.globalDaily],
  );
  if (!claimed.length) {
    const open = await db.query("select 1 from peeks where household_id = $1 and closed_at is null", [householdId]);
    if (open.length) return fail(409, "You're already looking at a page. Close it first.");
    return fail(429, "That's all the safe looks for today. They come back tomorrow.");
  }

  let sessionId: string | null = null;
  let handedOver = false;
  let abandoned = false;
  try {
    const creating = kernel.browsers.create({
      headless: false,
      stealth: false,
      timeout_seconds: PEEK.backstopSeconds,
      start_url: page.url,
      viewport: VIEWPORT[view],
    });
    // A browser that arrives after we gave up is deleted as soon as it does, even after the response went out.
    keepAlive(
      creating.then(
        (b) => (abandoned ? deleteBrowser(kernel, b.session_id, "arrived too late") : undefined),
        () => undefined, // a failed create is reported by the await below
      ),
    );
    sessionId = (await withTimeout(creating, opts.createMs ?? CREATE_MS,"starting the cloud browser")).session_id;
    const sealed = (opts.seal ?? sealValue)(PEEK_SEAL, sessionId);
    const live = await db.query<{ left: number }>(
      `update peeks set session_sealed = $2 where id = $1 and closed_at is null
       returning greatest(0, floor(extract(epoch from ends_at - now())))::int as left`,
      [id, sealed],
    );
    if (!live.length) return fail(409, "The look was closed before the page opened.");
    handedOver = true;
    return json(200, { secondsLeft: live[0]!.left, view });
  } catch (e) {
    console.error(`[spotter] peek: starting a cloud browser for ${paymentId} failed:`, msg(e));
    return sessionId ? fail(500, "The page couldn't be shown safely, so it was closed.") : fail(502, "The cloud browser didn't start. Try again in a minute.");
  } finally {
    if (!handedOver) {
      if (!sessionId) abandoned = true;
      await db
        .query("update peeks set closed_at = now(), close_reason = coalesce(close_reason, 'failed') where id = $1 and closed_at is null", [id])
        .catch((e) => console.error(`[spotter] peek: couldn't mark peek ${id} closed:`, msg(e)));
      if (sessionId) await deleteBrowser(kernel, sessionId, "start didn't finish");
    }
  }
}

/** The household's open, unexpired peek on this payment, with its session id opened. Expired ones are swept first. */
async function livePeek(db: Db, kernel: PeekKernel, householdId: string, paymentId: string) {
  await sweepPeeks(db, kernel);
  const rows = await db.query<{ id: string; view: PeekView; session_sealed: string | null }>(
    `select id, view, session_sealed from peeks
     where household_id = $1 and payment_id = $2 and closed_at is null and ends_at > now() and session_sealed is not null`,
    [householdId, paymentId],
  );
  const row = rows[0];
  if (!row) return null;
  const sessionId = openSession(row.session_sealed);
  if (!sessionId) {
    await endPeek(db, kernel, row.id, null, "unreadable");
    return null;
  }
  return { id: row.id, view: row.view, sessionId };
}

async function endPeek(db: Db, kernel: PeekKernel, id: string, sessionId: string | null, reason: string) {
  try {
    await db.query("update peeks set closed_at = now(), close_reason = $2 where id = $1 and closed_at is null", [id, reason]);
  } finally {
    if (sessionId) await deleteBrowser(kernel, sessionId, reason);
  }
}

const isGone = (e: unknown) => {
  const s = (e as { status?: unknown })?.status;
  return s === 404 || s === 410;
};
const ENDED = "This look has ended.";

export async function peekFrame(db: Db, householdId: string, paymentId: string, opts: Opts = {}): Promise<Response> {
  const kernel = await client(opts);
  if (!kernel) return fail(503, "The cloud browser isn't set up on this server.");
  const peek = await livePeek(db, kernel, householdId, paymentId);
  if (!peek) return fail(410, ENDED);
  const slot = await db.query(
    `update peeks set last_frame_at = now() where id = $1
     and (last_frame_at is null or last_frame_at < now() - make_interval(secs => $2)) returning id`,
    [peek.id, PEEK.minFrameMs / 1000],
  );
  if (!slot.length) return fail(429, "Too many pictures asked for at once.");
  try {
    const shot = await withTimeout(kernel.browsers.computer.captureScreenshot(peek.sessionId), CALL_MS, "taking a picture");
    const type = shot.headers.get("content-type") ?? "";
    if (Number(shot.headers.get("content-length") ?? 0) > MAX_FRAME_BYTES) {
      await shot.body?.cancel().catch(() => undefined);
      console.error(`[spotter] peek: KERNEL's picture for ${paymentId} was too big`);
      return fail(502, "The picture didn't come through.");
    }
    const bytes = new Uint8Array(await shot.arrayBuffer());
    const png = bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!shot.ok || !/^image\/png\b/.test(type) || !png || bytes.length > MAX_FRAME_BYTES) {
      console.error(`[spotter] peek: KERNEL's picture for ${paymentId} wasn't a usable PNG (${shot.status}, ${type}, ${bytes.length} bytes)`);
      return fail(502, "The picture didn't come through.");
    }
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": String(bytes.length) },
    });
  } catch (e) {
    if (isGone(e)) {
      await endPeek(db, kernel, peek.id, null, "gone");
      return fail(410, ENDED);
    }
    console.error(`[spotter] peek: taking a picture for ${paymentId} failed:`, msg(e));
    return fail(502, "The picture didn't come through.");
  }
}

export async function peekScroll(db: Db, householdId: string, paymentId: string, direction: "up" | "down", opts: Opts = {}): Promise<Response> {
  if (direction !== "up" && direction !== "down") return fail(400, "Scroll up or down.");
  const kernel = await client(opts);
  if (!kernel) return fail(503, "The cloud browser isn't set up on this server.");
  const peek = await livePeek(db, kernel, householdId, paymentId);
  if (!peek) return fail(410, ENDED);
  const v = VIEWPORT[peek.view] ?? VIEWPORT.desktop;
  try {
    // The mouse wheel in the middle of the screen: no click, no key, nothing typed.
    await withTimeout(kernel.browsers.computer.scroll(peek.sessionId, { x: Math.round(v.width / 2), y: Math.round(v.height / 2), delta_y: direction === "down" ? 5 : -5 }), CALL_MS, "scrolling");
    return json(200, { ok: true });
  } catch (e) {
    if (isGone(e)) {
      await endPeek(db, kernel, peek.id, null, "gone");
      return fail(410, ENDED);
    }
    console.error(`[spotter] peek: scrolling for ${paymentId} failed:`, msg(e));
    return fail(502, "The page didn't scroll.");
  }
}

/** Ends the household's open peek on this payment and deletes its browser. Closing twice is fine. */
export async function closePeek(db: Db, householdId: string, paymentId: string, opts: Opts = {}): Promise<Response> {
  const kernel = await client(opts);
  const rows = await db.query<{ session_sealed: string | null }>(
    "update peeks set closed_at = now(), close_reason = 'closed' where household_id = $1 and payment_id = $2 and closed_at is null returning session_sealed",
    [householdId, paymentId],
  );
  await deleteAll(kernel, rows, "closed");
  return json(200, { closed: rows.length });
}

/** For the routes: anything that still throws (the database, say) becomes a plain JSON error, logged once. */
export async function safely(what: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    console.error(`[spotter] peek: ${what} failed:`, msg(e));
    return fail(500, "Something went wrong on our side. The look was not opened or has ended.");
  }
}
