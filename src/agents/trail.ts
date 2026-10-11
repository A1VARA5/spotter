// "Where the money goes, and proof we never touched it". Built from what the KERNEL visit read (forms, the page's own
// scripts) and from KERNEL's telemetry of that visit (network, page, interaction and control events). Nothing is
// submitted: a form's target is read from the page, a script's target from its source text. Pure code, tested alone.
// Honesty rule for the proof: a count Spotter can't back with telemetry it confirmed is null ("not recorded"), never 0.
import { createHash } from "node:crypto";
import { getDomain } from "tldts";

/** One KERNEL telemetry envelope, as much of it as Spotter reads. */
export type TelemetryItem = { event: { type: string; category: string; data?: Record<string, unknown> | null } };
/** The categories KERNEL echoed back as on for this browser (null when it didn't say). */
export type TelemetryOn = { interaction: boolean; control: boolean; network: boolean; page: boolean };

export type TrailStep = { host: string; how: "link" | "redirect" | "landed" };
export type MoneyTarget = { host: string; how: "form" | "script" };
export type MoneyTrail = {
  /** The shop's own site: the registrable domain the page ended up on. */
  shop: string;
  /** Where a card or bank form on the page would send what is typed into it. */
  targets: MoneyTarget[];
  /** The first target that isn't the shop's own site, if any. */
  offsite: MoneyTarget | null;
  /** One plain line about where card details would go, or null when the page has no card or bank form. */
  line: string | null;
  steps: TrailStep[];
  stepsFrom: "network log" | "start and end only";
  /** Set when this trail comes from the phone visit (only the phone was shown the form). */
  face?: "phone";
};

const MAX_TARGETS = 20;

const absolute = (u: string, base: string): string | null => {
  try {
    const x = new URL(u, base);
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null;
  } catch {
    return null;
  }
};
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
const siteOf = (u: string) => {
  const h = hostOf(u);
  return h ? (getDomain(h) ?? h) : "";
};

// A string literal given to something that sends data: fetch(...), sendBeacon(...), xhr.open("POST", ...),
// form.action = ..., or $.post / axios.post(...). Only the literal is read; nothing is run.
const SENDS = [
  /\b(?:fetch|sendBeacon)\s*\(\s*(['"`])([^'"`\s]{1,500})\1/g,
  /\.open\s*\(\s*['"`][A-Za-z]{3,7}['"`]\s*,\s*(['"`])([^'"`\s]{1,500})\1/g,
  /\.action\s*=\s*(['"`])([^'"`\s]{1,500})\1/g,
  /\b(?:\$|jQuery|axios)\.(?:post|ajax|put)\s*\(\s*(['"`])([^'"`\s]{1,500})\1/g,
];

/** Where the page's scripts would send data, in the order written, as absolute http(s) addresses. */
export function scriptSendTargets(js: string, base: string): string[] {
  const text = js.slice(0, 200_000);
  const found: Array<{ at: number; url: string }> = [];
  for (const re of SENDS) for (const m of text.matchAll(re)) found.push({ at: m.index ?? 0, url: m[2]! });
  const out: string[] = [];
  for (const f of found.sort((a, b) => a.at - b.at)) {
    const u = absolute(f.url, base);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

export type TrailInput = {
  startUrl: string;
  finalUrl: string;
  /** Forms on the page: where they post (resolved), and whether they ask for card or bank details. */
  forms: Array<{ action: string; money: boolean; /** Asks for bank details rather than a card. */ bank?: boolean }>;
  /** scriptSendTargets() of the page's own scripts. */
  scriptTargets: string[];
  /** KERNEL telemetry of the visit, or null when it wasn't recorded or couldn't be read. */
  items: TelemetryItem[] | null;
};

export function moneyTrail(input: TrailInput): MoneyTrail {
  const shop = siteOf(input.finalUrl);
  const moneyForms = input.forms.filter((f) => f.money);
  const targets: MoneyTarget[] = [];
  const add = (u: string, how: MoneyTarget["how"]) => {
    const host = hostOf(u);
    if (host && !targets.some((t) => t.host === host) && targets.length < MAX_TARGETS) targets.push({ host, how });
  };
  for (const f of moneyForms) add(f.action || input.finalUrl, "form");
  // A script's target only matters here when there is something to send: a card or bank form on the page.
  if (moneyForms.length) for (const u of input.scriptTargets) add(u, "script");
  const offsite = targets.find((t) => (getDomain(t.host) ?? t.host) !== shop) ?? null;
  const what = moneyForms.length && moneyForms.every((f) => f.bank) ? "Bank details" : "Card details";
  const line = !moneyForms.length
    ? null
    : offsite
      ? `${what} on this page would go to ${offsite.host}, not to the shop (${shop}).`
      : `${what} on this page would go to the shop's own site (${shop}).`;
  return { shop, targets, offsite, line, ...redirectSteps(input) };
}

/** The hops from the link to the page, named, from the browser's own log of top level document requests. */
function redirectSteps(input: TrailInput): Pick<MoneyTrail, "steps" | "stepsFrom"> {
  const ends = (): TrailStep[] => {
    const a = hostOf(input.startUrl);
    const b = hostOf(input.finalUrl);
    return a === b || !b ? [{ host: a || b, how: "landed" }] : [{ host: a, how: "link" }, { host: b, how: "landed" }];
  };
  if (!input.items) return { steps: ends(), stepsFrom: "start and end only" };
  const docs = input.items
    .map((i) => i.event)
    .filter((e) => e.type === "network_request" && e.data?.resource_type === "Document" && (e.data?.target_type ?? "page") === "page");
  const hosts: string[] = [];
  for (const e of docs) {
    const h = hostOf(String(e.data?.url ?? ""));
    if (h && hosts.at(-1) !== h) hosts.push(h);
    if (hosts.length >= 10) break;
  }
  if (!hosts.length) return { steps: ends(), stepsFrom: "start and end only" };
  const steps = hosts.map((host, i): TrailStep => ({ host, how: i === 0 ? "link" : i === hosts.length - 1 ? "landed" : "redirect" }));
  if (steps.length === 1) steps[0]!.how = "landed";
  return { steps, stepsFrom: "network log" };
}

export type Proof = {
  /** Clicks and taps on the page during Spotter's visit; null when not recorded. */
  clicks: number | null;
  /** Keys typed or text inserted; null when not recorded. */
  keys: number | null;
  /** Scrolls during the automatic visit (the spotter's own scrolls in "look at it safely" are counted separately). */
  scrolls: number | null;
  /** True only when KERNEL echoed back Chrome's "block all downloads" policy for this browser. */
  downloadsBlocked: boolean | null;
  /** Calls Spotter made to KERNEL for this visit. */
  apiCalls: number;
  /** SHA-256 of exactly what Spotter stored: the screenshot's JPEG bytes and the page text. */
  hashes: { screenshot?: string; text?: string; phoneScreenshot?: string };
  /** Whether the browser was deleted at the end (set after the visit). */
  deleted?: boolean;
};

const SHOT = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;
export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export function buildProof(input: {
  telemetry: { enabled: TelemetryOn | null; items: TelemetryItem[] | null } | null;
  policyEcho: Record<string, unknown> | null | undefined;
  apiCalls: number;
  screenshot?: string;
  pageText?: string;
}): Proof {
  const t = input.telemetry;
  const read = t && t.enabled && t.items ? { on: t.enabled, events: t.items.map((i) => i.event) } : null;
  const count = (f: (e: TelemetryItem["event"]) => boolean) => (read ? read.events.filter(f).length : 0);
  const method = (e: TelemetryItem["event"]) => String(e.data?.method ?? "");
  const kind = (e: TelemetryItem["event"]) => String(e.data?.event_type ?? "");
  const pageOn = !!read?.on.interaction;
  const controlOn = !!read?.on.control;
  // A click is one the page saw, or a press, tap or touch Spotter's own automation sent through KERNEL.
  const sentClicks = count((e) => e.type === "cdp_command" && ((method(e) === "Input.dispatchMouseEvent" && kind(e) === "mousePressed") || method(e) === "Input.synthesizeTapGesture" || (method(e) === "Input.dispatchTouchEvent" && kind(e) === "touchStart")));
  const sentKeys = count((e) => e.type === "cdp_command" && ((method(e) === "Input.dispatchKeyEvent" && /^(keyDown|rawKeyDown|char)$/.test(kind(e))) || method(e) === "Input.insertText" || method(e) === "Input.imeSetComposition"));
  // Clicks in a frame from another site may not show in the page's own log, so clicks need the control log too.
  const clicks = pageOn && controlOn ? count((e) => e.type === "interaction_click") + sentClicks : null;
  // Typing into a password field never shows in the page's own log, so keys need the control log too.
  const keys = pageOn && controlOn ? count((e) => e.type === "interaction_key") + sentKeys : null;
  const scrolls = pageOn ? count((e) => e.type === "interaction_scroll_settled") : null;

  const echo = input.policyEcho;
  const downloadsBlocked = echo && typeof echo === "object" ? echo.DownloadRestrictions === 3 : null;

  const hashes: Proof["hashes"] = {};
  const m = input.screenshot ? SHOT.exec(input.screenshot) : null;
  if (m) hashes.screenshot = sha256(Buffer.from(m[1]!, "base64"));
  if (typeof input.pageText === "string" && input.pageText) hashes.text = sha256(Buffer.from(input.pageText, "utf8"));
  return { clicks, keys, scrolls, downloadsBlocked, apiCalls: input.apiCalls, hashes };
}

/** Both faces' proof as one: counts add up, and anything one visit didn't record or confirm isn't claimed for both. */
export function mergeProof(desk: Proof, phone: Proof): Proof {
  const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
  const d = desk.downloadsBlocked;
  const q = phone.downloadsBlocked;
  return {
    clicks: add(desk.clicks, phone.clicks),
    keys: add(desk.keys, phone.keys),
    scrolls: add(desk.scrolls, phone.scrolls),
    downloadsBlocked: d === false || q === false ? false : d === null || q === null ? null : true,
    apiCalls: desk.apiCalls + phone.apiCalls,
    hashes: { ...desk.hashes, ...(phone.hashes.screenshot ? { phoneScreenshot: phone.hashes.screenshot } : {}) },
    ...(desk.deleted === undefined || phone.deleted === undefined ? {} : { deleted: desk.deleted && phone.deleted }),
  };
}

/** The money trail to show: the desktop's, unless only the phone was shown a card or bank form. */
export function phoneTrail(desk: MoneyTrail, phone: MoneyTrail | undefined): MoneyTrail {
  if (desk.line || !phone?.line) return desk;
  return { ...phone, line: `On the phone version, ${phone.line.charAt(0).toLowerCase()}${phone.line.slice(1).replace(" on this page", "")}`, face: "phone" };
}

/** Reads which telemetry categories KERNEL says are on from its create response (null when it didn't say). */
export function telemetryOn(echo: unknown): TelemetryOn | null {
  const b = (echo as { browser?: Record<string, { enabled?: unknown } | undefined> } | null | undefined)?.browser;
  if (!b || typeof b !== "object") return null;
  const on = (k: string) => b[k]?.enabled === true;
  return { interaction: on("interaction"), control: on("control"), network: on("network"), page: on("page") };
}
