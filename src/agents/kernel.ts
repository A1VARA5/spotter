// Opens a suspicious link or shop page in a throwaway KERNEL cloud browser (kernel.sh), so nobody in the family has
// to click it. Hard limits: one page load, 15 seconds, the browser is always deleted, and the code we run only reads:
// it never types, clicks or submits. In the same visit it compares what a person can see on the page with all the text
// an AI agent reads there (src/agents/seen.ts), and KERNEL records the visit as a short video replay.
// "Two faces" (visitTwoFaces): the same link is opened at the same moment as Gran's UK phone too, because scam kits
// show scanners a harmless page and keep the trap for real phones (src/agents/twofaces.ts).
// KERNEL's telemetry of the visit gives where a card form would send its details and the proof that Spotter never
// clicked or typed (src/agents/trail.ts). Chrome's own policy blocks every download in these browsers.
// Everything the page says (title, hidden text, scripts) is a stranger's text: callers must treat it as data.
import { z } from "zod";
import { SEEN_VS_READ, judgeHidden, type HiddenFinding } from "./seen";
import { readShopTools, type ShopTools } from "./webmcp";
import { compareFaces, palette, type FaceSnap, type FacesResult, type PhoneNetwork } from "./twofaces";
import { buildProof, mergeProof, moneyTrail, phoneTrail, scriptSendTargets, telemetryOn, type MoneyTrail, type Proof, type TelemetryItem } from "./trail";

export type PageAsks = { card: boolean; login: boolean; giftCard: boolean; bank?: boolean };
export type PageSeen = { domChars: number; visibleChars: number; visibleSample: string; hidden: HiddenFinding[]; isolated: boolean; truncated: boolean };
/** Where on the screenshot the card or bank form sits, as fractions of the screen (0 to 1). */
export type Box = { x: number; y: number; w: number; h: number };
/** What the phone visit saw, kept for the case file next to the desktop visit. */
export type PhoneFace = { finalUrl: string; title: string; asks: PageAsks; screenshot?: string; network: PhoneNetwork; moneyBox?: Box };
export type Face = "desktop" | "phone";
export type PageVisit =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      title: string;
      asks: PageAsks;
      screenshot?: string;
      seen?: PageSeen;
      replayUrl?: string;
      /** The tools the page registers for AI agents (WebMCP), listed and checked, never run. */
      tools?: ShopTools;
      /** The page's struck through "was" price, as written there (plain text, short). */
      was?: string;
      /** The product picture the page shares (og:image), only when it is an https link. */
      productImage?: string;
      /** Where a card or bank form would send what is typed, and the named redirect hops. */
      trail?: MoneyTrail;
      /** What KERNEL's telemetry says Spotter did on the page (nothing), downloads blocked, hashes of what was stored. */
      proof?: Proof;
      /** Where the card or bank form sits on the screenshot. */
      moneyBox?: Box;
      /** For a phone face visit: how it reached the page. */
      network?: PhoneNetwork;
      /** Visible text and a tiny colour histogram, only for comparing two faces (not stored). */
      snap?: FaceSnap;
      /** Two faces: the phone visit and the comparison (visitTwoFaces only). */
      phone?: PhoneFace;
      faces?: FacesResult;
    }
  | { ok: false; url: string; error: string };

type CreateBody = {
  headless?: boolean;
  stealth?: boolean;
  timeout_seconds?: number;
  viewport?: { width: number; height: number };
  proxy?: { id: string };
  region?: "us-east" | "eu-west" | "ap-southeast";
  chrome_policy?: Record<string, unknown>;
  telemetry?: { browser: Record<string, { enabled: boolean }> };
};

/** The slice of the @onkernel/sdk client this uses, so tests can pass a fake. */
export type KernelLike = {
  browsers: {
    create(body: CreateBody): Promise<{ session_id: string; chrome_policy?: Record<string, unknown>; telemetry?: unknown }>;
    deleteByID(id: string): Promise<unknown>;
    playwright: {
      execute(id: string, body: { code: string; timeout_sec?: number }): Promise<{ success: boolean; result?: unknown; error?: string }>;
    };
    /** Tools pages register for AI agents (WebMCP). Listing only: Spotter never runs a page's tools. */
    webmcp?: {
      listTools(id: string, query?: { exclude_custom?: boolean }): Promise<unknown>;
    };
    /** Session recordings. Optional so a client without them still opens pages, just without a replay. */
    replays?: {
      start(id: string, body?: { max_duration_in_seconds?: number }): Promise<{ replay_id: string; replay_view_url?: string }>;
      stop(replayId: string, params: { id_or_name: string }): Promise<unknown>;
    };
    /** The visit's telemetry events. Optional: without it the proof says "not recorded". */
    telemetry?: {
      events(id: string, query?: { category?: string[]; since?: string; limit?: number }): Promise<unknown>;
    };
  };
};

const TIMEOUT_MS = 15_000;
const MAX_SHOT_BYTES = 60_000;
const MAX_THUMB_BYTES = 20_000;
const PHONE = { width: 390, height: 844 };
const TELEMETRY_LIMIT = 1000;

// Chrome enterprise policy: DownloadRestrictions 3 blocks every download. KERNEL echoes the policies it applied.
const CHROME_POLICY = { DownloadRestrictions: 3 };
// Telemetry: network (where requests go), page (navigations), interaction (clicks, keys, scrolls the page saw). The
// operational categories, control among them (every command sent to the browser), are on by default.
const TELEMETRY = { browser: { network: { enabled: true }, page: { enabled: true }, interaction: { enabled: true } } };

// A replay link we will show: KERNEL's own replay viewer over https, nothing else. It carries a signed token for that
// one recording (no API key), and KERNEL keeps recordings for a day on our plan.
const REPLAY = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.kernel\.sh(:\d+)?\/browser\/replays\?[A-Za-z0-9._~%&=-]+$/;
export const isReplayUrl = (u: unknown): u is string => typeof u === "string" && u.length <= 4000 && REPLAY.test(u);

// Gran's phone: an Android phone browser (it matches the engine KERNEL runs), British English, London time. These are
// set on the page's own DevTools session before it loads and stay on while it is open.
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
const phonePrelude = `
const phone = await page.context().newCDPSession(page);
await phone.send("Emulation.setUserAgentOverride", { userAgent: ${JSON.stringify(PHONE_UA)}, acceptLanguage: "en-GB,en", platform: "Linux armv8l", userAgentMetadata: { platform: "Android", platformVersion: "14", architecture: "", model: "Pixel 8", mobile: true } });
await phone.send("Emulation.setDeviceMetricsOverride", { width: ${PHONE.width}, height: ${PHONE.height}, deviceScaleFactor: 1, mobile: true });
await phone.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await phone.send("Emulation.setLocaleOverride", { locale: "en-GB" });
await phone.send("Emulation.setTimezoneOverride", { timezoneId: "Europe/London" });
`;

// Runs inside KERNEL's browser VM. Read only on purpose: goto, read the DOM, screenshot. Nothing else.
// The seen vs read pass runs in an isolated world (same DOM, its own JavaScript globals), so a page can't fake the
// answers by overriding getComputedStyle and friends. If that isn't available it runs in the page and says so.
// Forms are read, never sent: where each one posts (its action), and the page's own inline scripts as text.
const pageCode = (url: string, face: Face) => `
${face === "phone" ? phonePrelude : "await page.setViewportSize({ width: 800, height: 600 });"}
await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded", timeout: 9000 });
await page.waitForTimeout(800);
const factsHandle = await page.evaluateHandle(() => {
  const inputs = Array.from(document.querySelectorAll("input"));
  const about = (i) => [i.type, i.name, i.id, i.autocomplete, i.placeholder, i.getAttribute("aria-label")].join(" ").toLowerCase();
  const isCard = (i) => /cc-|card.?num|cardnumber|cvv|cvc|security.?code|expir/.test(about(i));
  const isBank = (i) => /sort.?code|account.?(num|no)|iban|routing|swift/.test(about(i));
  const text = (document.body ? document.body.innerText : "").slice(0, 20000).toLowerCase();
  const W = innerWidth || 1, H = innerHeight || 1;
  const box = (el) => { const r = el.getBoundingClientRect(); const c = (v) => Math.max(0, Math.min(1, v)); const x = c(r.left / W), y = c(r.top / H); return { x, y, w: c(r.right / W) - x, h: c(r.bottom / H) - y }; };
  const groups = Array.from(document.forms).slice(0, 10).map((f) => ({ el: f, ins: Array.from(f.querySelectorAll("input")) }));
  const loose = inputs.filter((i) => !i.form && (isCard(i) || isBank(i)));
  if (loose.length) groups.push({ el: loose[0].parentElement || loose[0], ins: loose, loose: true });
  let moneyEl = null;
  const moneyForms = groups.map((g) => {
    const card = g.ins.some(isCard), bank = g.ins.some(isBank);
    if ((card || bank) && !moneyEl) moneyEl = g.el;
    let action = "";
    try { action = g.loose ? location.href : new URL(g.el.getAttribute("action") || location.href, location.href).href; } catch (e) { action = ""; }
    return { action: action.slice(0, 500), card, bank, box: card || bank ? box(g.el) : null };
  }).filter((f) => f.card || f.bank);
  return { moneyEl, facts: {
    password: inputs.some((i) => i.type === "password"),
    card: inputs.some(isCard) || /card number|cvv|security code/.test(text),
    bank: inputs.some(isBank) || /sort code|account number|\\biban\\b/.test(text),
    login: inputs.some((i) => /user|login|email|passcode/.test(about(i))) && /sign in|log in|login|verify your account/.test(text),
    giftCard: /gift ?card|voucher code|redeem(ption)? code|steam card|itunes card|apple gift|google play card|card pin/.test(text),
    forms: document.forms.length,
    moneyForms,
    scripts: Array.from(document.scripts).filter((s) => !s.src).map((s) => s.textContent || "").join("\\n").slice(0, 50000),
    // A struck through "was" price, and the product picture the page shares, for "spot the difference".
    was: (() => { const el = document.querySelector("s, del, strike, [class~='was'], [class*='was-price'], [class*='compare-at'], [class*='old-price']"); return el ? (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60) : ""; })(),
    image: (() => { const m = document.querySelector('meta[property="og:image"]'); return m ? String(m.getAttribute("content") || "").slice(0, 2000) : ""; })(),
  } };
});
const facts = await factsHandle.evaluate((o) => o.facts);
let seen = null;
let isolated = false;
let seenError = "";
let thumb = "";
try {
  const cdp = await page.context().newCDPSession(page);
  const tree = await cdp.send("Page.getFrameTree");
  const world = await cdp.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: "spotter-seen" });
  const out = await cdp.send("Runtime.evaluate", { expression: "(" + ${JSON.stringify(SEEN_VS_READ)} + ")()", contextId: world.executionContextId, returnByValue: true });
  if (out.result && out.result.value) { seen = out.result.value; isolated = true; }
  else seenError = "isolated world: " + String((out.exceptionDetails && out.exceptionDetails.text) || "no result").slice(0, 200);
  // A tiny picture of the screen (about 40 pixels wide), only for comparing the colours of two visits.
  try { const vp = page.viewportSize() || { width: ${PHONE.width}, height: ${PHONE.height} }; const t = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 0.05 } }); thumb = t.data || ""; } catch (e) { thumb = ""; }
  await cdp.detach();
} catch (e) { seenError = "isolated world: " + String((e && e.message) || e).slice(0, 200); }
if (!seen) { try { seen = await page.evaluate(${SEEN_VS_READ}); } catch (e) { seenError += " page: " + String((e && e.message) || e).slice(0, 200); } }
// The card form is measured again just before the picture, and the picture comes straight from a DevTools session, so
// the outline lands on the form even when the page reflowed after load. A form that can't be measured gets no outline
// (null), never the stale one from load time, and says why in the log.
let shotBox = null;
let shot = "";
try {
  const measured = await factsHandle.evaluate((o) => {
    if (!o.moneyEl) return null;
    if (!o.moneyEl.isConnected) return "gone";
    const W = innerWidth || 1, H = innerHeight || 1, r = o.moneyEl.getBoundingClientRect(), c = (v) => Math.max(0, Math.min(1, v));
    const x = c(r.left / W), y = c(r.top / H);
    return { x, y, w: c(r.right / W) - x, h: c(r.bottom / H) - y };
  });
  if (measured === "gone") seenError += " box: the card form was replaced, so it isn't outlined";
  else shotBox = measured;
} catch (e) { seenError += " box: " + String((e && e.message) || e).slice(0, 100); }
let sc = null;
try {
  sc = await page.context().newCDPSession(page);
  const s = await sc.send("Page.captureScreenshot", { format: "jpeg", quality: 40 });
  shot = s.data || "";
} catch (e) { seenError += " picture: " + String((e && e.message) || e).slice(0, 100); }
finally { if (sc) await sc.detach().catch(() => {}); }
if (!shot) shot = (await page.screenshot({ type: "jpeg", quality: 40 })).toString("base64");
return { finalUrl: page.url(), title: (await page.title()).slice(0, 200), facts, seen, isolated, seenError: seenError.slice(0, 500), shot, thumb, shotBox };
`;

const BoxSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) });
const Result = z.object({
  finalUrl: z.string().max(4000),
  title: z.string().max(400),
  facts: z.object({
    password: z.boolean(),
    card: z.boolean(),
    login: z.boolean(),
    giftCard: z.boolean(),
    bank: z.boolean().optional(),
    moneyForms: z.array(z.object({ action: z.string().max(600), card: z.boolean(), bank: z.boolean(), box: BoxSchema.nullable() })).max(11).optional(),
    scripts: z.string().max(60_000).optional(),
    was: z.string().max(100).optional(),
    image: z.string().max(2100).optional(),
  }),
  seen: z
    .object({
      domChars: z.number().int().nonnegative(),
      visibleChars: z.number().int().nonnegative(),
      visibleSample: z.string().max(2000),
      visibleText: z.string().max(4100).optional(),
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
  thumb: z.string().max(40_000).optional(),
  /** Where the card form was at the moment of the picture (null when it had gone or the picture fell back). */
  shotBox: BoxSchema.nullable().optional(),
});

async function defaultClient(apiKey: string): Promise<KernelLike> {
  const { default: Kernel } = await import("@onkernel/sdk");
  return new Kernel({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS }) as unknown as KernelLike;
}

const plainText = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f<>"`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** How the phone face reaches the page: a KERNEL proxy (UK mobile or home network) and region, or neither. */
export type PhoneRoute = { proxyId?: string; kind: PhoneNetwork; region?: "us-east" | "eu-west" | "ap-southeast" };

type VisitOpts = { client?: KernelLike; apiKey?: string; timeoutMs?: number; record?: boolean; face?: Face; network?: PhoneRoute };

export async function visitInCloud(url: string, opts: VisitOpts = {}): Promise<PageVisit> {
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

  const face: Face = opts.face ?? "desktop";
  const limit = opts.timeoutMs ?? TIMEOUT_MS;
  // The phone face isn't recorded (one video per case is enough), but it stays headful: a headless browser is easier
  // for a scam kit to spot, and the point is to look like a real phone.
  const record = face === "desktop" && (opts.record ?? true);
  const headful = record || face === "phone";
  const started = Date.now();
  let session: string | null = null;
  let finished = false;
  let calls = 0;
  let done: Extract<PageVisit, { ok: true }> | null = null;
  let client: KernelLike | null = opts.client ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`the cloud browser ran out of time (${Math.round(limit / 1000)} s)`)), limit)));
  try {
    const run = async (): Promise<PageVisit> => {
      client ??= await defaultClient(apiKey!);
      // The inactivity timeout is a backstop: if our delete below ever fails, KERNEL ends the session itself.
      const base: CreateBody = { headless: !headful, timeout_seconds: 20, chrome_policy: CHROME_POLICY, telemetry: TELEMETRY };
      let network: PhoneNetwork | undefined;
      let browser: Awaited<ReturnType<KernelLike["browsers"]["create"]>>;
      if (face === "phone") {
        const route = opts.network ?? { kind: "direct" as const };
        const routed: CreateBody = { ...base, viewport: PHONE, ...(route.proxyId ? { proxy: { id: route.proxyId } } : {}), ...(route.region ? { region: route.region } : {}) };
        try {
          calls++;
          browser = await client.browsers.create(routed);
          network = route.proxyId ? route.kind : "direct";
        } catch (e) {
          // Only a refusal (4xx: the plan or the proxy said no) falls back. A timeout or server error may have made the
          // browser anyway, so trying again would leave one nobody counts or deletes; that visit fails instead.
          const status = (e as { status?: unknown })?.status;
          if ((!route.proxyId && !route.region) || typeof status !== "number" || status < 400 || status >= 500) throw e;
          // The plan or the proxy said no: still open it as a phone, without the UK network, and say so.
          console.error("[spotter] KERNEL refused the UK phone network, opening as a plain phone instead:", e instanceof Error ? e.message : e);
          calls++;
          browser = await client.browsers.create({ ...base, viewport: PHONE });
          network = "direct";
        }
      } else {
        calls++;
        browser = await client.browsers.create(base);
      }
      session = browser.session_id;
      // Created after we already gave up: delete it now, nobody else will.
      if (finished) {
        await deleteSession(client, browser.session_id);
        throw new Error("the browser arrived too late");
      }
      const replay = record ? await startReplay(client, browser.session_id) : null;
      if (record && client.browsers.replays) calls++;
      const left = Math.max(1, Math.floor((limit - (Date.now() - started)) / 1000));
      calls++;
      const res = await client.browsers.playwright.execute(browser.session_id, { code: pageCode(parsed.toString(), face), timeout_sec: left });
      if (!res.success) return fail(`The page didn't load: ${(res.error ?? "unknown error").slice(0, 200)}`);
      const r = Result.safeParse(res.result);
      if (!r.success) {
        console.error(`[spotter] KERNEL result on ${parsed.host} didn't match:`, r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        return fail("The cloud browser sent back something unexpected.");
      }
      // In the same visit, on the page that just loaded: the tools it offers AI agents (desktop face only).
      // Its own short limit, so a slow listing can't cost the page visit that already worked.
      const tools = face === "desktop" ? await listShopTools(client, browser.session_id, Math.max(300, Math.min(5000, limit - (Date.now() - started) - 1500))) : undefined;
      if (tools) calls++;
      // Stopped before the delete in finally, so KERNEL saves the video. A replay that didn't save just isn't shown.
      const replayUrl = replay && (calls++, await stopReplay(client, browser.session_id, replay.id)) ? replay.url : undefined;
      const { finalUrl, title, facts, seen, isolated, seenError, shot, thumb, shotBox } = r.data;
      const items = await readTelemetry(client, browser.session_id, finalUrl, Math.max(300, Math.min(3000, limit - (Date.now() - started) - 500)));
      if (client.browsers.telemetry) calls++;
      // A check the page broke, or one that had to run where the page could fake it, is logged rather than hidden.
      if (seenError) console.error(`[spotter] page checks on ${parsed.host}:${seenError}`);
      const small = shot && Buffer.byteLength(shot, "base64") <= MAX_SHOT_BYTES ? `data:image/jpeg;base64,${shot}` : undefined;
      const visibleSample = seen ? plainText(seen.visibleSample, 400) : "";
      const moneyForms = facts.moneyForms ?? [];
      // Page scripts: the page's own inline scripts plus the script files telemetry saw (text, cut by KERNEL).
      const fileScripts = (items ?? [])
        .filter((i) => i.event.type === "network_response" && i.event.data?.resource_type === "Script" && typeof i.event.data?.body === "string")
        .map((i) => String(i.event.data!.body))
        .join("\n");
      const trail = moneyTrail({
        startUrl: parsed.toString(),
        finalUrl,
        forms: moneyForms.map((f) => ({ action: f.action, money: true, bank: f.bank && !f.card })),
        scriptTargets: scriptSendTargets(`${facts.scripts ?? ""}\n${fileScripts}`, finalUrl),
        items,
      });
      const proof = buildProof({
        telemetry: { enabled: telemetryOn(browser.telemetry), items },
        policyEcho: browser.chrome_policy,
        apiCalls: calls,
        screenshot: small,
        pageText: visibleSample,
      });
      // The box measured just before the picture, so the outline sits on the form in that picture. Null means there was
      // no form or it couldn't be measured, so nothing is outlined; only a result without the field uses the first read.
      const box = shotBox === undefined ? (moneyForms.find((f) => f.box)?.box ?? undefined) : shotBox && shotBox.w > 0 && shotBox.h > 0 ? shotBox : undefined;
      const asks: PageAsks = { card: facts.card, login: facts.login || facts.password, giftCard: facts.giftCard, ...(facts.bank ? { bank: true } : {}) };
      const thumbBuf = thumb && Buffer.byteLength(thumb, "base64") <= MAX_THUMB_BYTES ? Buffer.from(thumb, "base64") : null;
      const pal = thumbBuf ? palette(thumbBuf) : null;
      done = {
        ok: true,
        url,
        finalUrl,
        title,
        asks,
        ...(small ? { screenshot: small } : {}),
        ...(seen
          ? {
              seen: {
                domChars: seen.domChars,
                visibleChars: seen.visibleChars,
                visibleSample,
                hidden: judgeHidden(seen.hidden).slice(0, 8),
                isolated: isolated === true,
                truncated: seen.truncated === true,
              },
            }
          : {}),
        ...(replayUrl ? { replayUrl } : {}),
        ...(tools ? { tools } : {}),
        ...(facts.was && plainText(facts.was, 60) ? { was: plainText(facts.was, 60) } : {}),
        ...(facts.image && /^https:\/\/[^\s"<>]+$/.test(facts.image) ? { productImage: facts.image } : {}),
        trail,
        proof,
        ...(box ? { moneyBox: box } : {}),
        ...(network ? { network } : {}),
        snap: {
          finalUrl,
          title: plainText(title, 200),
          ...(seen ? { text: plainText(seen.visibleText ?? seen.visibleSample, 4000) } : {}),
          visibleChars: seen?.visibleChars ?? 0,
          asks: { card: asks.card, bank: !!asks.bank, login: asks.login, giftCard: asks.giftCard },
          ...(pal ? { palette: pal } : {}),
        },
      };
      return done;
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
    if (client && session) {
      const deleted = await deleteSession(client, session);
      // The proof says whether the browser is really gone; this runs before the caller sees the visit.
      const v = done as Extract<PageVisit, { ok: true }> | null;
      if (v?.proof) v.proof = { ...v.proof, apiCalls: v.proof.apiCalls + 1, deleted };
    }
  }
}

/**
 * Two faces: the same link opened at the same moment as a plain desktop (with the replay, the hidden text check and
 * the tool listing) and as Gran's phone. Two browsers, both deleted. The desktop visit is the case's page as before;
 * the phone visit and the comparison ride along. A failed phone visit is "couldn't compare", never "the same".
 */
export async function visitTwoFaces(url: string, opts: Omit<VisitOpts, "face"> = {}): Promise<PageVisit> {
  const network = opts.network ?? (await phoneRoute(opts));
  const [desk, phone] = await Promise.all([visitInCloud(url, { ...opts, face: "desktop" }), visitInCloud(url, { ...opts, face: "phone", network })]);
  if (!desk.ok) return desk;
  const kind = phone.ok ? (phone.network ?? "direct") : network.kind;
  const faces = compareFaces(desk.snap ?? null, phone.ok ? (phone.snap ?? null) : null, kind);
  if (!phone.ok) console.error(`[spotter] the phone face visit failed, so two faces couldn't compare: ${phone.error}`);
  // The proof covers both browsers; the money trail is the phone's when only the phone was shown a card form.
  const trail = phone.ok && desk.trail ? phoneTrail(desk.trail, phone.trail) : desk.trail;
  // A phone visit that failed may still have had a browser: its clicks, keys and delete weren't recorded, so the
  // proof doesn't claim them for both.
  const proof = !desk.proof
    ? undefined
    : phone.ok && phone.proof
      ? mergeProof(desk.proof, phone.proof)
      : { clicks: null, keys: null, scrolls: null, downloadsBlocked: null, apiCalls: desk.proof.apiCalls, hashes: desk.proof.hashes };
  return {
    ...desk,
    faces,
    ...(trail ? { trail } : {}),
    ...(proof ? { proof } : {}),
    ...(phone.ok
      ? {
          phone: {
            finalUrl: phone.finalUrl,
            title: plainText(phone.title, 120),
            asks: phone.asks,
            network: kind,
            ...(phone.screenshot ? { screenshot: phone.screenshot } : {}),
            ...(phone.moneyBox ? { moneyBox: phone.moneyBox } : {}),
          },
        }
      : {}),
  };
}

// The UK phone network: one KERNEL mobile proxy in Great Britain, made once and found again by name. KERNEL_PHONE_PROXY
// can name another proxy, or say "off" to open the phone face without one. Region eu-west puts the browser itself in
// Europe. Anything failing here means a plain phone face, never a failed case.
const PROXY_NAME = "spotter-uk-mobile";
let routeCache: { at: number; route: PhoneRoute } | null = null;

async function phoneRoute(opts: { client?: KernelLike; apiKey?: string }): Promise<PhoneRoute> {
  const setting = process.env.KERNEL_PHONE_PROXY ?? PROXY_NAME;
  if (setting === "off") return { kind: "direct" };
  if (routeCache && Date.now() - routeCache.at < (routeCache.route.proxyId ? 6 * 3600_000 : 10 * 60_000)) return routeCache.route;
  const route = await findProxy(setting, opts).catch((e): PhoneRoute => {
    console.error("[spotter] the UK phone network isn't available, the phone face opens without it:", e instanceof Error ? e.message : e);
    return { kind: "direct" };
  });
  routeCache = { at: Date.now(), route };
  return route;
}

type ProxyApi = {
  list(): Promise<unknown>;
  create(body: { type: "mobile"; name: string; config: { country: string } }): Promise<{ id?: string }>;
};

async function findProxy(name: string, opts: { client?: KernelLike; apiKey?: string }): Promise<PhoneRoute> {
  const apiKey = opts.apiKey ?? process.env.KERNEL_API_KEY;
  if (opts.client || !apiKey) return { kind: "direct" };
  const { default: Kernel } = await import("@onkernel/sdk");
  const proxies = (new Kernel({ apiKey, maxRetries: 0, timeout: 5000 }) as unknown as { proxies: ProxyApi }).proxies;
  const listed = (await proxies.list()) as { items?: ProxyInfo[] };
  const found = listed.items?.find((p) => p.name === name);
  if (found) return routeFromProxy(found);
  // Only Spotter's own proxy is made when missing (a GB mobile proxy, made once and reused).
  if (name !== PROXY_NAME) return { kind: "direct" };
  return routeFromProxy(await proxies.create({ type: "mobile", name, config: { country: "GB" } }));
}

type ProxyInfo = { id?: string; name?: string; type?: string; status?: string; config?: { country?: string } };

/**
 * The phone route a KERNEL proxy gives: only a mobile or residential proxy in Great Britain that is available counts as
 * a UK network. Anything else isn't used, so the case file never claims a UK network it didn't have.
 */
export function routeFromProxy(p: ProxyInfo): PhoneRoute {
  const uk = String(p.config?.country ?? "").toUpperCase() === "GB";
  const ok = !p.status || p.status === "available";
  if (!p.id || !uk || !ok) return { kind: "direct" };
  if (p.type === "mobile") return { proxyId: p.id, kind: "uk_mobile", region: "eu-west" };
  if (p.type === "residential") return { proxyId: p.id, kind: "uk_residential", region: "eu-west" };
  return { kind: "direct" };
}

/**
 * The visit's telemetry: network, page, interaction and control events. Null (so the proof says "not recorded") when
 * the client can't read it, the read fails or is slow, or the log doesn't even show the page Spotter opened.
 */
async function readTelemetry(client: KernelLike, session: string, finalUrl: string, ms: number): Promise<TelemetryItem[] | null> {
  if (!client.browsers.telemetry) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = (await Promise.race([
      client.browsers.telemetry.events(session, { category: ["network", "page", "interaction", "control"], since: "5m", limit: TELEMETRY_LIMIT }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))),
    ])) as { items?: unknown; data?: unknown };
    const raw = Array.isArray(page?.items) ? page.items : Array.isArray(page?.data) ? page.data : null;
    if (!raw) throw new Error("no events list in the answer");
    // A cut off log could leave out the clicks or keys at its end, and zero would then be a guess.
    if (raw.length >= TELEMETRY_LIMIT || (page as { has_more?: unknown }).has_more === true) throw new Error(`the log has more than ${TELEMETRY_LIMIT} events`);
    const items = raw.filter((i): i is TelemetryItem => !!i && typeof i === "object" && typeof (i as TelemetryItem).event?.type === "string");
    const host = (u: string) => {
      try {
        return new URL(u).host;
      } catch {
        return "";
      }
    };
    const want = host(finalUrl);
    const sawPage = items.some((i) => (i.event.type === "page_navigation" || i.event.type === "network_request") && host(String(i.event.data?.url ?? "")) === want);
    if (!sawPage) {
      console.error("[spotter] KERNEL's telemetry doesn't show the page Spotter opened yet, so the proof says not recorded");
      return null;
    }
    return items;
  } catch (e) {
    console.error("[spotter] reading KERNEL's telemetry failed (the proof says not recorded):", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
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

/**
 * The page's own WebMCP tools (custom tools excluded), read and judged. Undefined when the client can't list tools;
 * a failed listing is logged and comes back as "not checked", so it never reads as "this shop offers no tools".
 */
async function listShopTools(client: KernelLike, session: string, ms: number): Promise<ShopTools | undefined> {
  if (!client.browsers.webmcp) {
    console.error("[spotter] this KERNEL client can't list a page's tools for AI agents, so they weren't checked");
    return undefined;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const listed = await Promise.race([
      client.browsers.webmcp.listTools(session, { exclude_custom: true }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))),
    ]);
    return readShopTools(listed);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[spotter] listing the page's tools for AI agents failed (the visit goes on without them):", error);
    return { checked: false, error: "Spotter couldn't list the tools this page offers AI agents." };
  } finally {
    clearTimeout(timer);
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

async function deleteSession(client: KernelLike, id: string): Promise<boolean> {
  try {
    await client.browsers.deleteByID(id);
    return true;
  } catch (e) {
    console.error(`[spotter] deleting cloud browser ${id} failed (KERNEL's inactivity timeout will end it):`, e instanceof Error ? e.message : e);
    return false;
  }
}
