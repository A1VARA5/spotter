// Opens a suspicious link or shop page in a throwaway KERNEL cloud browser (kernel.sh), so nobody in the family has
// to click it. Hard limits: one page load, 15 seconds, the browser is always deleted, and the code we run only reads:
// it never types, clicks or submits. In the same visit it compares what a person can see on the page with all the text
// an AI agent reads there (src/agents/seen.ts), and KERNEL records the visit as a short video replay.
// Everything the page says (title, hidden text) is a stranger's text: callers must treat it as data.
import { z } from "zod";
import { SEEN_VS_READ, judgeHidden, type HiddenFinding } from "./seen";

export type PageAsks = { card: boolean; login: boolean; giftCard: boolean };
export type PageSeen = { domChars: number; visibleChars: number; visibleSample: string; hidden: HiddenFinding[]; isolated: boolean; truncated: boolean };
export type PageVisit =
  | { ok: true; url: string; finalUrl: string; title: string; asks: PageAsks; screenshot?: string; seen?: PageSeen; replayUrl?: string }
  | { ok: false; url: string; error: string };

/** The slice of the @onkernel/sdk client this uses, so tests can pass a fake. */
export type KernelLike = {
  browsers: {
    create(body: { headless?: boolean; stealth?: boolean; timeout_seconds?: number }): Promise<{ session_id: string }>;
    deleteByID(id: string): Promise<unknown>;
    playwright: {
      execute(id: string, body: { code: string; timeout_sec?: number }): Promise<{ success: boolean; result?: unknown; error?: string }>;
    };
    /** Session recordings. Optional so a client without them still opens pages, just without a replay. */
    replays?: {
      start(id: string, body?: { max_duration_in_seconds?: number }): Promise<{ replay_id: string; replay_view_url?: string }>;
      stop(replayId: string, params: { id_or_name: string }): Promise<unknown>;
    };
  };
};

const TIMEOUT_MS = 15_000;
const MAX_SHOT_BYTES = 60_000;

// A replay link we will show: KERNEL's own replay viewer over https, nothing else. It carries a signed token for that
// one recording (no API key), and KERNEL keeps recordings for a day on our plan.
const REPLAY = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.kernel\.sh(:\d+)?\/browser\/replays\?[A-Za-z0-9._~%&=-]+$/;
export const isReplayUrl = (u: unknown): u is string => typeof u === "string" && u.length <= 4000 && REPLAY.test(u);

// Runs inside KERNEL's browser VM. Read only on purpose: goto, read the DOM, screenshot. Nothing else.
// The seen vs read pass runs in an isolated world (same DOM, its own JavaScript globals), so a page can't fake the
// answers by overriding getComputedStyle and friends. If that isn't available it runs in the page and says so.
const pageCode = (url: string) => `
await page.setViewportSize({ width: 800, height: 600 });
await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded", timeout: 9000 });
await page.waitForTimeout(800);
const facts = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll("input"));
  const about = (i) => [i.type, i.name, i.id, i.autocomplete, i.placeholder, i.getAttribute("aria-label")].join(" ").toLowerCase();
  const text = (document.body ? document.body.innerText : "").slice(0, 20000).toLowerCase();
  return {
    password: inputs.some((i) => i.type === "password"),
    card: inputs.some((i) => /cc-|card.?num|cardnumber|cvv|cvc|security.?code|expir/.test(about(i))) || /card number|cvv|security code/.test(text),
    login: inputs.some((i) => /user|login|email|passcode/.test(about(i))) && /sign in|log in|login|verify your account/.test(text),
    giftCard: /gift ?card|voucher code|redeem(ption)? code|steam card|itunes card|apple gift|google play card|card pin/.test(text),
    forms: document.forms.length,
  };
});
let seen = null;
let isolated = false;
let seenError = "";
try {
  const cdp = await page.context().newCDPSession(page);
  const tree = await cdp.send("Page.getFrameTree");
  const world = await cdp.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: "spotter-seen" });
  const out = await cdp.send("Runtime.evaluate", { expression: "(" + ${JSON.stringify(SEEN_VS_READ)} + ")()", contextId: world.executionContextId, returnByValue: true });
  if (out.result && out.result.value) { seen = out.result.value; isolated = true; }
  else seenError = "isolated world: " + String((out.exceptionDetails && out.exceptionDetails.text) || "no result").slice(0, 200);
  await cdp.detach();
} catch (e) { seenError = "isolated world: " + String((e && e.message) || e).slice(0, 200); }
if (!seen) { try { seen = await page.evaluate(${SEEN_VS_READ}); } catch (e) { seenError += " page: " + String((e && e.message) || e).slice(0, 200); } }
const shot = await page.screenshot({ type: "jpeg", quality: 40 });
return { finalUrl: page.url(), title: (await page.title()).slice(0, 200), facts, seen, isolated, seenError, shot: shot.toString("base64") };
`;

const Result = z.object({
  finalUrl: z.string().max(4000),
  title: z.string().max(400),
  facts: z.object({ password: z.boolean(), card: z.boolean(), login: z.boolean(), giftCard: z.boolean() }),
  seen: z
    .object({
      domChars: z.number().int().nonnegative(),
      visibleChars: z.number().int().nonnegative(),
      visibleSample: z.string().max(2000),
      hidden: z
        .array(z.object({ text: z.string().max(1300), why: z.enum(["hidden_css", "transparent", "tiny_text", "zero_size", "off_screen", "clipped", "same_colour", "covered"]) }))
        .max(150),
      truncated: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  isolated: z.boolean().optional(),
  seenError: z.string().max(500).optional(),
  shot: z.string().optional(),
});

async function defaultClient(apiKey: string): Promise<KernelLike> {
  const { default: Kernel } = await import("@onkernel/sdk");
  return new Kernel({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS }) as unknown as KernelLike;
}

const plainText = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f<>"`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function visitInCloud(
  url: string,
  opts: { client?: KernelLike; apiKey?: string; timeoutMs?: number; record?: boolean } = {},
): Promise<PageVisit> {
  const fail = (error: string): PageVisit => ({ ok: false, url, error });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("That isn't a web address.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fail("Only web links (http or https) are opened.");

  const apiKey = opts.apiKey ?? process.env.KERNEL_API_KEY;
  if (!opts.client && !apiKey) return fail("The cloud browser (KERNEL) isn't set up, so the link wasn't opened.");

  const limit = opts.timeoutMs ?? TIMEOUT_MS;
  const record = opts.record ?? true;
  const started = Date.now();
  let session: string | null = null;
  let finished = false;
  let client: KernelLike | null = opts.client ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`the cloud browser ran out of time (${Math.round(limit / 1000)} s)`)), limit)));
  try {
    const run = async (): Promise<PageVisit> => {
      client ??= await defaultClient(apiKey!);
      // Headful when recording: KERNEL only records (and live views) headful browsers. The inactivity timeout is a
      // backstop: if our delete below ever fails, KERNEL ends the session itself.
      const browser = await client.browsers.create({ headless: !record, timeout_seconds: 20 });
      session = browser.session_id;
      // Created after we already gave up: delete it now, nobody else will.
      if (finished) {
        await deleteSession(client, browser.session_id);
        throw new Error("the browser arrived too late");
      }
      const replay = record ? await startReplay(client, browser.session_id) : null;
      const left = Math.max(1, Math.floor((limit - (Date.now() - started)) / 1000));
      const res = await client.browsers.playwright.execute(browser.session_id, { code: pageCode(parsed.toString()), timeout_sec: left });
      if (!res.success) return fail(`The page didn't load: ${(res.error ?? "unknown error").slice(0, 200)}`);
      const r = Result.safeParse(res.result);
      if (!r.success) return fail("The cloud browser sent back something unexpected.");
      // Stopped before the delete in finally, so KERNEL saves the video. A replay that didn't save just isn't shown.
      const replayUrl = replay && (await stopReplay(client, browser.session_id, replay.id)) ? replay.url : undefined;
      const { finalUrl, title, facts, seen, isolated, seenError, shot } = r.data;
      // A check the page broke, or one that had to run where the page could fake it, is logged rather than hidden.
      if (seenError) console.error(`[spotter] seen vs read on ${parsed.host}:${seenError}`);
      const small = shot && Buffer.byteLength(shot, "base64") <= MAX_SHOT_BYTES ? `data:image/jpeg;base64,${shot}` : undefined;
      return {
        ok: true,
        url,
        finalUrl,
        title,
        asks: { card: facts.card, login: facts.login || facts.password, giftCard: facts.giftCard },
        ...(small ? { screenshot: small } : {}),
        ...(seen
          ? {
              seen: {
                domChars: seen.domChars,
                visibleChars: seen.visibleChars,
                visibleSample: plainText(seen.visibleSample, 400),
                hidden: judgeHidden(seen.hidden).slice(0, 8),
                isolated: isolated === true,
                truncated: seen.truncated === true,
              },
            }
          : {}),
        ...(replayUrl ? { replayUrl } : {}),
      };
    };
    // Even after a timeout, the finally below deletes the browser if it was created in time.
    const pending = run();
    // After a timeout nobody awaits this any more, so a late failure is logged here instead of going unhandled.
    pending.catch((e) => {
      if (finished) console.error("[spotter] cloud browser failed after the time limit:", e instanceof Error ? e.message : e);
    });
    return await Promise.race([pending, timeout]);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[spotter] cloud browser visit failed: ${error}`);
    return fail(`The cloud browser couldn't open it: ${error.slice(0, 200)}`);
  } finally {
    finished = true;
    clearTimeout(timer);
    if (client && session) await deleteSession(client, session);
  }
}

/** Starts KERNEL's recording. A missing or failed recording never stops the visit; it is logged and skipped. */
async function startReplay(client: KernelLike, session: string): Promise<{ id: string; url: string } | null> {
  if (!client.browsers.replays) return null;
  try {
    const r = await client.browsers.replays.start(session, { max_duration_in_seconds: 20 });
    if (!isReplayUrl(r.replay_view_url)) {
      console.error("[spotter] KERNEL replay started without a link we recognise, so it won't be shown");
      return null;
    }
    return { id: r.replay_id, url: r.replay_view_url };
  } catch (e) {
    console.error("[spotter] starting the KERNEL replay failed (the visit goes on without one):", e instanceof Error ? e.message : e);
    return null;
  }
}

async function stopReplay(client: KernelLike, session: string, replayId: string): Promise<boolean> {
  try {
    await client.browsers.replays!.stop(replayId, { id_or_name: session });
    return true;
  } catch (e) {
    console.error("[spotter] stopping the KERNEL replay failed, so it won't be shown:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function deleteSession(client: KernelLike, id: string) {
  try {
    await client.browsers.deleteByID(id);
  } catch (e) {
    console.error(`[spotter] deleting cloud browser ${id} failed (KERNEL's inactivity timeout will end it):`, e instanceof Error ? e.message : e);
  }
}
