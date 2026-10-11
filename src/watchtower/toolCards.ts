// What each of Spotter's tool calls shows in AG Studio's chat (aiToolDisplay): a plain line on the row,
// a pill, and a short card underneath. Tool results carry words scammers wrote (payee names, messages,
// links), so a card is built only from counts, numbers and Spotter's own fixed labels. A string from a
// result is shown only when it matches one of those labels exactly; everything else is counted, never echoed.
import { accessOf, type Access } from "./receipt";

export const CARD_TOOLS = ["open_case_file", "watch_alerts", "scam_radar", "paypal_status", "real_price", "fair_prices", "add_page", "my_month"] as const;

export type CallStatus = "streaming" | "ready" | "awaiting_approval" | "executing" | "done" | "cancelled";
type Result = { success: true; response?: string; data?: unknown } | { success: false; issues?: unknown };
export type Card = { text: string; pill?: string; lines: string[]; access: Access | "unknown"; took?: number };

const WORDS: Record<(typeof CARD_TOOLS)[number], [running: string, done: string]> = {
  open_case_file: ["Opening a case file", "Opened a case file"],
  watch_alerts: ["Checking what needs attention", "Checked what needs attention"],
  scam_radar: ["Checking the scam radar", "Checked the scam radar"],
  paypal_status: ["Reading PayPal's record", "Read PayPal's record"],
  real_price: ["Checking real shop prices", "Checked real shop prices"],
  fair_prices: ["Checking this month's prices", "Checked this month's prices"],
  add_page: ["Adding a page", "Added a page"],
  my_month: ["Looking at your month", "Looked at your month"],
};

// Spotter's own labels (data.ts). Only these strings ever pass from a result to the screen, lower cased.
const OUTCOMES = new Set(["Paid", "Protected", "Waiting", "Denied", "Stopped", "Checking", "Paying", "Failed"]);
const KINDS: Record<string, string> = { Person: "A person", Kid: "A kid", "AI agent": "An AI agent" };
const METHODS = new Set(["PayPal", "Friends and Family", "Gift card", "Crypto", "Bank transfer"]);
const SIGNS = new Set(["Pressure to hurry", "Pretending to be someone", "Asks for Friends and Family", "Gift cards or crypto", "Hidden instructions for AI", "Price looks wrong", "Brand new shop", "Bank details changed", "Something else odd"]);
const ALERT_KINDS: Record<string, [string, string]> = {
  waiting: ["payment waiting", "payments waiting"],
  spike: ["spike in holds", "spikes in holds"],
  repeat_payee: ["payee hitting several people", "payees hitting several people"],
  new_sign: ["new kind of scam sign", "new kinds of scam sign"],
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick = (v: unknown, allowed: Set<string>) => (typeof v === "string" && allowed.has(v) ? v : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const gbp = (n: number) => `£${n.toFixed(2)}`;
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

// Web addresses written any of the usual ways; an email address is not a link.
const LINK = /(?:https?:\/\/|www\.)[^\s"'<>]+|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|co|uk|org|net|io|info|shop|store|xyz|app|online|site|example)\b(?:\/[^\s"'<>]*)?/gi;
export function linkCount(texts: readonly string[]): number {
  return texts.reduce((n, t) => n + (t.match(LINK)?.length ?? 0), 0);
}

const LEFT_OUT = "Names, messages and links are left out here: a scammer may have written them.";

function caseFile(d: Record<string, unknown>): { pill?: string; lines: string[] } {
  const f = obj(d.facts);
  const outcome = pick(f.outcome, OUTCOMES);
  const who = typeof f.kind === "string" ? KINDS[f.kind] : undefined;
  const method = pick(f.method, METHODS);
  const parts = [who ?? "Someone", "paying", f.newPayee === "Yes" ? "a new payee" : f.newPayee === "No" ? "a payee they've paid before" : "a payee"];
  if (method) parts.push(`by ${method}`);
  const signs = arr(d.signs).map(obj);
  const byKind = new Map<string, number>();
  let other = 0;
  for (const s of signs) {
    const k = pick(s.sign, SIGNS);
    if (k) byKind.set(k, (byKind.get(k) ?? 0) + 1);
    else other++;
  }
  const high = signs.filter((s) => s.severity === "high" || s.severity === "High").length;
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.toLowerCase()}`);
  if (other) kinds.push(`${other} other`);
  const findings = arr(d.caseFindings).length;
  const links = linkCount(strings([d.reasons, signs.map((s) => s.why), d.caseHeadline, d.caseFindings]));
  return {
    pill: [outcome, signs.length ? plural(signs.length, "sign") : null].filter(Boolean).join(", ") || undefined,
    lines: [
      `One payment${outcome ? `, ${outcome.toLowerCase()}` : ""}. ${parts.join(" ")}.`,
      signs.length ? `${plural(signs.length, "scam sign")}${high ? `, ${high} high` : ""}: ${kinds.join(", ")}.` : "No scam signs on file.",
      `${plural(links, "link")} in the text, ${plural(findings, "case worker finding")}.`,
      LEFT_OUT,
    ],
  };
}

function alerts(d: Record<string, unknown>) {
  const list = arr(d.alerts).map(obj);
  if (!list.length) return { pill: "None", lines: ["Nothing needs attention right now."] };
  const by = new Map<string, number>();
  let other = 0;
  for (const a of list) {
    if (typeof a.kind === "string" && ALERT_KINDS[a.kind]) by.set(a.kind, (by.get(a.kind) ?? 0) + 1);
    else other++;
  }
  const bits = [...by].map(([k, n]) => `${n} ${ALERT_KINDS[k]![n === 1 ? 0 : 1]}`);
  if (other) bits.push(`${other} other`);
  return { pill: plural(list.length, "alert"), lines: [`${plural(list.length, "alert")}: ${bits.join(", ")}.`, "Worked out by Spotter's code, not by the assistant."] };
}

function radar(d: Record<string, unknown>) {
  const list = arr(d.payees).map(obj);
  const hit = list.filter((p) => (num(p.families) ?? 0) > 0);
  const families = hit.reduce((t, p) => t + (num(p.families) ?? 0), 0);
  return {
    pill: plural(list.length, "payee"),
    lines: [
      list.length ? `${plural(list.length, "stopped payee")}. ${hit.length} also stopped by other Spotter families (${plural(families, "family", "families")} in all).` : "This family hasn't stopped anyone this month.",
      "Counts only: no other family's details, and payee names are left out here.",
    ],
  };
}

function paypal(d: Record<string, unknown>) {
  if (d.found !== true) return { lines: ["No payment with that id on the board."] };
  const outcome = pick(d.outcome, OUTCOMES);
  const events = arr(d.events).length;
  const held = num(d.heldAtPayPal) ?? 0;
  const ends = typeof d.holdExpires === "string" ? new Date(d.holdExpires) : null;
  const days = ends && Number.isFinite(ends.getTime()) ? Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86_400_000)) : null;
  const lines = [`One payment${outcome ? `, ${outcome.toLowerCase()}` : ""}. ${plural(events, "PayPal event")} on record.`];
  if (held > 0) lines.push(`${gbp(held)} held at PayPal${days !== null ? `, hold ends in ${plural(days, "day")}` : ""}.`);
  lines.push("Read from the board's copy of what PayPal said. PayPal wasn't called.");
  return { pill: plural(events, "event"), lines };
}

function price(d: Record<string, unknown>) {
  const offers = num(d.offers) ?? 0;
  const shops = arr(d.shops).length;
  const cheapest = num(obj(d.cheapest).price);
  const median = num(d.median);
  const head = `A live search of real shops: ${plural(offers, "listing")} from ${plural(shops, "shop")}.`;
  return {
    pill: plural(offers, "listing"),
    lines: [cheapest !== null ? `${head} Cheapest ${gbp(cheapest)}${median !== null ? `, typical ${gbp(median)}` : ""}.` : `${head} No price matched.`, "Shop names and the search words are left out here."],
  };
}

function fair(d: Record<string, unknown>) {
  const checked = num(d.checked) ?? 0;
  const paid = num(d.paidChecked) ?? 0;
  const over = num(d.overpaid) ?? 0;
  const saved = num(d.saved) ?? 0;
  const today = arr(d.today).map(obj);
  const matched = today.filter((t) => num(obj(t.cheapestToday).price) !== null).length;
  const gap = over > 0 ? `${gbp(over)} over the cheapest real shop at the time` : saved > 0 ? `${gbp(saved)} under the cheapest real shop at the time` : "never over the cheapest real shop at the time";
  return {
    pill: `${paid} paid, checked`,
    lines: [
      `${plural(checked, "price check")} this month, ${paid} on paid payments${paid ? `: ${gap}` : ""}.${d.allSample === true && checked ? " All sample month." : ""}`,
      today.length ? `Today's live search: ${plural(today.length, "item")}, ${matched} matched a real shop.` : "No live search today: nothing paid had a price check.",
      "Item and shop names are left out here.",
    ],
  };
}

function month(d: Record<string, unknown>) {
  const s = arr(d.stopped).length;
  const w = arr(d.waiting).length;
  const t = arr(d.tricks).length;
  return { pill: `${s} stopped, ${w} waiting`, lines: [`This month: ${s} stopped, ${w} waiting, ${plural(t, "kind")} of trick.`, "Names and reasons are left out here."] };
}

/** The card for one call. `args` are never shown: the model wrote them, maybe after reading a scammer's words. */
export function describeCall(name: string, _args: Record<string, unknown>, call: { status: CallStatus; result?: Result }): Card {
  const tool = (CARD_TOOLS as readonly string[]).includes(name) ? (name as (typeof CARD_TOOLS)[number]) : null;
  const access = accessOf(name);
  const settled = call.status === "done" || call.status === "cancelled";
  const words = tool ? WORDS[tool] : (["Using a tool", "Used a tool"] as const);
  const card: Card = { text: settled ? words[1] : words[0], lines: [], access };
  const r = call.result;
  if (!settled) return { ...card, lines: ["Working…"] };
  if (!r) return { ...card, pill: "Stopped", lines: ["Stopped before it finished. No money was touched."] };
  if (!r.success) return { ...card, lines: ["It didn't work. No money was touched."] };
  const d = obj(r.data);
  const took = num(d.took);
  if (took !== null) card.took = took;
  const body =
    tool === "open_case_file" ? caseFile(d)
    : tool === "watch_alerts" ? alerts(d)
    : tool === "scam_radar" ? radar(d)
    : tool === "paypal_status" ? paypal(d)
    : tool === "real_price" ? price(d)
    : tool === "fair_prices" ? fair(d)
    : tool === "my_month" ? month(d)
    : tool === "add_page" ? { pill: "Board change", lines: ["Added one empty page to the board. The receipt can undo it."] }
    : { lines: ["Spotter doesn't know this tool."] };
  return { ...card, ...body };
}
