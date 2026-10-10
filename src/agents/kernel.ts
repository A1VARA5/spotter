// Opens a suspicious link in a throwaway KERNEL cloud browser (onkernel.com), so nobody in the family has to click it.
// Hard limits: one page load, 15 seconds, the browser is always deleted, and the code we run only reads: it never
// types, clicks or submits. What the page says (its title) is a stranger's text: callers must treat it as data.
import { z } from "zod";

export type PageAsks = { card: boolean; login: boolean; giftCard: boolean };
export type PageVisit =
  | { ok: true; url: string; finalUrl: string; title: string; asks: PageAsks; screenshot?: string }
  | { ok: false; url: string; error: string };

/** The slice of the @onkernel/sdk client this uses, so tests can pass a fake. */
export type KernelLike = {
  browsers: {
    create(body: { headless?: boolean; stealth?: boolean; timeout_seconds?: number }): Promise<{ session_id: string }>;
    deleteByID(id: string): Promise<unknown>;
    playwright: {
      execute(id: string, body: { code: string; timeout_sec?: number }): Promise<{ success: boolean; result?: unknown; error?: string }>;
    };
  };
};

const TIMEOUT_MS = 15_000;
const MAX_SHOT_BYTES = 60_000;

// Runs inside KERNEL's browser VM. Read only on purpose: goto, read the DOM, screenshot. Nothing else.
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
const shot = await page.screenshot({ type: "jpeg", quality: 40 });
return { finalUrl: page.url(), title: (await page.title()).slice(0, 200), facts, shot: shot.toString("base64") };
`;

const Result = z.object({
  finalUrl: z.string().max(4000),
  title: z.string().max(400),
  facts: z.object({ password: z.boolean(), card: z.boolean(), login: z.boolean(), giftCard: z.boolean() }),
  shot: z.string().optional(),
});

async function defaultClient(apiKey: string): Promise<KernelLike> {
  const { default: Kernel } = await import("@onkernel/sdk");
  return new Kernel({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS }) as unknown as KernelLike;
}

export async function visitInCloud(
  url: string,
  opts: { client?: KernelLike; apiKey?: string; timeoutMs?: number } = {},
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
  const started = Date.now();
  let session: string | null = null;
  let finished = false;
  let client: KernelLike | null = opts.client ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`the cloud browser ran out of time (${Math.round(limit / 1000)} s)`)), limit)));
  try {
    const run = async (): Promise<PageVisit> => {
      client ??= await defaultClient(apiKey!);
      // The inactivity timeout is a backstop: if our delete below ever fails, KERNEL ends the session itself.
      const browser = await client.browsers.create({ headless: true, timeout_seconds: 20 });
      session = browser.session_id;
      // Created after we already gave up: delete it now, nobody else will.
      if (finished) {
        await deleteSession(client, browser.session_id);
        throw new Error("the browser arrived too late");
      }
      const left = Math.max(1, Math.floor((limit - (Date.now() - started)) / 1000));
      const res = await client.browsers.playwright.execute(browser.session_id, { code: pageCode(parsed.toString()), timeout_sec: left });
      if (!res.success) return fail(`The page didn't load: ${(res.error ?? "unknown error").slice(0, 200)}`);
      const r = Result.safeParse(res.result);
      if (!r.success) return fail("The cloud browser sent back something unexpected.");
      const { finalUrl, title, facts, shot } = r.data;
      const small = shot && Buffer.byteLength(shot, "base64") <= MAX_SHOT_BYTES ? `data:image/jpeg;base64,${shot}` : undefined;
      return {
        ok: true,
        url,
        finalUrl,
        title,
        asks: { card: facts.card, login: facts.login || facts.password, giftCard: facts.giftCard },
        ...(small ? { screenshot: small } : {}),
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

async function deleteSession(client: KernelLike, id: string) {
  try {
    await client.browsers.deleteByID(id);
  } catch (e) {
    console.error(`[spotter] deleting cloud browser ${id} failed (KERNEL's inactivity timeout will end it):`, e instanceof Error ? e.message : e);
  }
}
