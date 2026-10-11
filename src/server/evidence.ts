// The evidence pack: one plain, printable page about a payment Spotter held, stopped or that the spotter denied, to
// hand to a bank, PayPal's Resolution Centre or the police. HTML print view, and a .txt fallback.
// Same ownership check as the replay route: only the signed in household that owns the payment gets it.
// Built from picked fields only, never by spreading a database row: no sealed links (KERNEL replay), no KERNEL URLs,
// no case agent tool calls or model names, no approve link, no other family's data (the network is only a number).
// Everything a stranger wrote (the message, payee names, quotes, page titles) is escaped and the message is marked untrusted.
import type { Db } from "@/db";
import { getHousehold } from "@/core/households";
import { getPayment, getSpender, listEvents, type Payment } from "@/core/lifecycle";
import { networkCount, networkLine } from "@/core/network";
import { formatMoney, type Currency } from "@/core/types";
import { safeTz, whenText } from "@/core/holdtime";
import { SIGN_LABEL } from "@/watchtower/data";
import { BACKUP_LINE } from "@/core/aiwords";
import { peekActivity } from "./peek";
import { outcomeLine, settledCase } from "@/core/settled";
import { withoutIds } from "@/core/userText";

const EVIDENCE_STATUSES = new Set(["needs_approval", "voiding", "voided", "blocked", "protected"]);
// Only a JPEG data URL Spotter made itself is ever embedded (the same rule as the case file).
const SHOT = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

const TOOL: Record<string, string> = {
  payee_history: "Family history",
  network_reports: "Spotter network",
  check_links: "Links",
  find_genuine_offer: "Real shop prices (Channel3)",
  paypal_hold: "PayPal hold",
  open_link: "Cloud browser (KERNEL)",
  inspect_shop: "Cloud browser (KERNEL)",
};
const METHOD: Record<string, string> = {
  paypal_order: "PayPal payment",
  friends_and_family: "PayPal Friends and Family (no buyer protection)",
  gift_card: "Gift card",
  crypto: "Crypto",
  bank_transfer: "Bank transfer",
  other: "Other",
};
const VERDICT: Record<string, string> = { likely_scam: "Likely a scam", unclear: "Worth a closer look", looks_fine: "Looks genuine" };
const KIND: Record<string, string> = { agent: "AI agent", person: "Person", kid: "Kid" };
const FACE_DIFF: Record<string, string> = {
  final_site: "Where it ended up",
  asks_money: "Card or bank form",
  asks_login: "Log in",
  asks_gift_card: "Gift card",
  text: "Words on the page",
  title: "Page title",
  look: "Colours",
};
const STEP: Record<string, string> = { link: "The link", redirect: "Sent on to", landed: "Landed on" };

type Line = { at: string; what: string };
type Pack = {
  ref: string;
  title: string;
  generated: string;
  household: string;
  example: string | null;
  facts: Array<[string, string]>;
  timeline: Line[];
  message: string;
  reasons: string[];
  signs: Array<{ label: string; severity: string; quote: string; why: string }>;
  summary: string | null;
  /** Which AI wrote the scam check, said plainly when it wasn't Claude. */
  checkedBy: string | null;
  price: string | null;
  verdict: string | null;
  headline: string | null;
  findings: Array<{ label: string; text: string; quote?: string }>;
  network: string;
  page: { host: string; title: string; asks: string[]; hidden: string | null; screenshot: string | null } | null;
  faces: { verdict: string; how: string; differences: Array<[string, string, string]>; phoneShot: string | null } | null;
  trail: { line: string | null; steps: string } | null;
  proof: Array<[string, string]> | null;
};

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.slice(0, max) : "");

const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;
const INVISIBLE_RUN = /[​-‍⁠﻿‪-‮⁦-⁩]+/g;
// Control characters other than tab and new lines: they print as garbage and mean nothing to a person.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Text a stranger wrote, made safe to print: text hidden with invisible tag characters (a way to slip orders to an AI)
 * is shown decoded inside a visible [hidden text: "..."] marker, invisible spaces and direction flips become
 * [hidden text], and stray control characters are dropped. HTML escaping still happens after this.
 */
export function printable(raw: string): string {
  return raw
    .replace(TAG_RUN, (run) => {
      const decoded = [...run]
        .map((c) => String.fromCharCode(c.codePointAt(0)! - 0xe0000))
        .join("")
        .replace(CONTROL, "");
      return decoded.trim() ? `[hidden text: "${decoded}"]` : "[hidden text]";
    })
    .replace(INVISIBLE_RUN, "[hidden text]")
    .replace(CONTROL, "");
}
const say = (v: unknown, max = 400) => printable(str(v, max));
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

/** Where it stands: held while it waits, otherwise how it ended, in the same words as the app (core/settled.ts). */
function statusWords(p: Payment): string {
  if (p.status === "needs_approval") return "Held. PayPal is holding the money until the spotter decides. Nothing has been paid.";
  return outcomeLine(p) ?? "Not decided yet.";
}

function eventWords(type: string, data: Record<string, unknown>, tz: string): string {
  const by = str(data.by, 60);
  switch (type) {
    case "requested":
      return "Asked to pay";
    case "example_created":
      return "Example hold made for the demo family (the checks were written earlier)";
    case "checked":
      return data.ok === false
        ? "Spotter's scam check couldn't finish, so Spotter played safe"
        : data.engine === "openai_backup"
          ? "Spotter checked the message for scam signs (checked by the backup AI model, because Claude was unavailable)"
          : "Spotter checked the message for scam signs";
    case "decided":
      return (
        { ask: "Spotter held it and asked the spotter", block: "Spotter stopped it", protect: "Spotter didn't send it (no buyer protection)", allow: "Spotter let it through" }[str(data.outcome, 20)] ??
        "Spotter decided"
      );
    case "authorised":
      return `PayPal put the money on hold${ID.test(str(data.orderId, 80)) ? ` (order ${str(data.orderId, 80)})` : ""}`;
    case "case_built":
      return "Spotter finished looking into it";
    case "case_failed":
      return "Spotter couldn't finish looking into it";
    case "sleeping": {
      const until = new Date(str(data.until, 40));
      return `${by || "Someone"} chose to sleep on it${Number.isFinite(until.getTime()) ? `; Spotter would ask again ${whenText(until, tz)}` : ""}`;
    }
    case "asked_again":
      return "Spotter asked the spotter again";
    case "reauthorized":
      return `PayPal renewed the hold${ID.test(str(data.to, 80)) ? ` (new authorisation ${str(data.to, 80)})` : ""}`;
    case "reauth_failed":
      return "PayPal didn't renew the hold";
    case "approved":
      return `${by || "The spotter"} approved it`;
    case "captured":
      return "PayPal paid it";
    case "denied":
      return `${by || "The spotter"} said no`;
    case "agent_read":
      return "The agent read the shop's page, including a line hidden from people";
    case "withdrawn":
      return "The AI agent withdrew it";
    case "voided":
      return "PayPal released the hold. Nothing was paid";
    case "swapped":
      return `Replaced with a payment to ${str(data.shop, 80) || "a genuine shop"}`;
    case "paypal_settled":
      return "PayPal confirmed what happened";
    case "paypal_mismatch":
      return "PayPal and Spotter disagreed about this payment (left for a person to check)";
    case "reconciled":
      return "Spotter checked with PayPal";
    case "failed":
      return `Something went wrong${str(data.step, 30) ? ` (${str(data.step, 30)})` : ""}`;
    case "alert_failed":
    case "tell_failed":
    case "confirm_failed":
      return "A message from Spotter couldn't be delivered";
    case "report_failed":
      return "Spotter couldn't tell the Spotter network";
    default:
      return type.replace(/_/g, " ");
  }
}

async function buildPack(db: Db, householdId: string, p: Payment, now: Date): Promise<Pack> {
  const hh = await getHousehold(db, householdId);
  const tz = safeTz(hh?.time_zone);
  const spender = await getSpender(db, p.spender_id);
  const events = await listEvents(db, p.id);
  const at = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  const fmt = (v: string | Date) => at.format(v instanceof Date ? v : new Date(v));
  const denied = events.some((e) => e.type === "denied");
  const currency = p.currency as Currency;
  const amount = formatMoney({ amount: Number(p.amount), currency });
  const r = p.request;
  // Read after the decision: the PayPal hold line says what PayPal did, not that it is still holding the money.
  const c = p.case_file ? settledCase(p.case_file, p) : null;

  // Every authorisation this hold has had: the first one, then any PayPal reauthorization moved it to.
  const earlier = events.filter((e) => e.type === "reauthorized").map((e) => str((e.data as Record<string, unknown>)?.from, 80)).filter((id) => ID.test(id));
  const auths = [...earlier, p.paypal_authorization_id ?? ""].filter((id, i, all) => id && ID.test(id) && all.indexOf(id) === i);

  let network = "Spotter couldn't count other families' reports for this payee.";
  try {
    network = networkLine(await networkCount(db, r.payee.name, householdId), "this payee");
  } catch (e) {
    console.error(`[spotter] evidence pack network count for ${p.id} failed:`, e instanceof Error ? e.message : e);
  }

  const market = p.market;
  const price = market?.median
    ? `Real shop prices (Channel3): shops sell ${str(market.item, 120) || "this"} for about ${formatMoney({ amount: market.median, currency })} (${market.offers} offers checked).`
    : null;

  const trap = c?.page?.seen?.hidden.find((h) => h.instruction);
  const shot = c?.page?.screenshot && SHOT.test(c.page.screenshot) ? c.page.screenshot : null;
  const asks = c?.page ? ([c.page.asks.card && "card details", c.page.asks.login && "a login", c.page.asks.giftCard && "a gift card code"].filter(Boolean) as string[]) : [];
  const pg = c?.page;
  const faces = pg?.faces
    ? {
        verdict: str(pg.faces.verdict, 300),
        how: !pg.phone
          ? "Spotter tried to open the link as a desktop and as a phone at the same moment, but the phone visit didn't work, so the two couldn't be compared."
          : `Spotter opened the link twice at the same moment: as a desktop, the way security scanners see it, and as a phone${pg.phone.network !== "direct" ? ` on a UK ${pg.phone.network === "uk_residential" ? "home" : "mobile"} network` : " set to UK English and UK time (not on a UK network)"}.`,
        differences: pg.faces.compared ? pg.faces.differences.slice(0, 6).map((d): [string, string, string] => [FACE_DIFF[d.kind] ?? "Difference", str(d.desktop, 120), str(d.phone, 120)]) : [],
        phoneShot: pg.phone?.screenshot && SHOT.test(pg.phone.screenshot) ? pg.phone.screenshot : null,
      }
    : null;
  const trail = pg?.trail ? { line: pg.trail.line ? str(pg.trail.line, 300) : null, steps: pg.trail.steps.map((s) => `${STEP[s.how] ?? s.how}: ${str(s.host, 120)}`).join(", then ") } : null;
  let peeks: { peeks: number; scrolls: number } | null = null;
  try {
    peeks = pg ? await peekActivity(db, p.id) : null;
  } catch (e) {
    console.error(`[spotter] evidence pack peek count for ${p.id} failed:`, e instanceof Error ? e.message : e);
  }
  const pr = pg?.proof;
  const n = (v: number | null | undefined) => (typeof v === "number" ? String(v) : "Not recorded");
  const proof: Array<[string, string]> | null = pr
    ? [
        ["Clicks", n(pr.clicks)],
        ["Keys typed", n(pr.keys)],
        ["Scrolls during Spotter's visit", n(pr.scrolls)],
        ["Looking at it yourself", peeks === null ? "Not recorded" : peeks.peeks ? `${peeks.peeks} ${peeks.peeks === 1 ? "look" : "looks"}, ${peeks.scrolls} scrolls asked for (scrolling is the only thing possible there)` : "Not used"],
        ["Downloads", pr.downloadsBlocked === true ? "Blocked by a Chrome policy that blocks every download (the cloud browser reported it as applied)" : pr.downloadsBlocked === false ? "Not confirmed blocked" : "Not recorded"],
        ["Calls Spotter made to the cloud browser", String(pr.apiCalls)],
        ["Browser deleted afterwards", pr.deleted === true ? "Yes" : pr.deleted === false ? "Not confirmed (the cloud browser ends itself after 20 seconds idle)" : "Not recorded"],
        ["SHA-256 of the screenshot", pr.hashes.screenshot && /^[0-9a-f]{64}$/.test(pr.hashes.screenshot) ? pr.hashes.screenshot : "No screenshot stored"],
        ["SHA-256 of the page text", pr.hashes.text && /^[0-9a-f]{64}$/.test(pr.hashes.text) ? pr.hashes.text : "No page text stored"],
      ]
    : null;
  const stopped = p.status === "blocked" || p.status === "protected";
  const released = p.status === "voided" || p.status === "voiding";
  const title = released ? (denied ? "A payment that was denied" : "A payment that was released") : stopped ? "A payment Spotter stopped" : "A payment Spotter is holding";

  return {
    ref: p.id,
    title,
    generated: fmt(now),
    household: str(hh?.name, 80),
    example: hh?.demo || c?.example ? "Example data: this comes from Spotter's demo family, not from a real payment." : null,
    facts: [
      ["Who wanted to pay", `${str(spender?.name, 60) || "Someone"}${spender ? ` (${KIND[spender.kind] ?? spender.kind})` : ""}`],
      ["Paying to (as given)", str(r.payee.name, 120)],
      ["Amount", amount],
      ["What for", [str(r.category, 60), str(r.item, 200)].filter(Boolean).join(": ")],
      ["How they were asked to pay", METHOD[r.method] ?? str(r.method, 40)],
      ["Asked at", fmt(p.created_at)],
      ["Where it stands", statusWords(p)],
      ["PayPal order id", ID.test(p.paypal_order_id ?? "") ? p.paypal_order_id! : "None (nothing was sent to PayPal)"],
      ["PayPal authorisation id", auths.length ? auths.join(", then ") : "None"],
      ...(ID.test(p.paypal_capture_id ?? "") ? ([["PayPal capture id", p.paypal_capture_id!]] as Array<[string, string]>) : []),
      // PayPal's own record of which agent key asked for the order (set by Spotter on agent orders, kept by PayPal).
      ...(p.paypal_custom_id ? ([["PayPal custom_id (which agent key asked)", str(p.paypal_custom_id, 127)]] as Array<[string, string]>) : []),
      ["Spotter reference", p.id],
    ],
    timeline: events.map((e) => ({ at: fmt(e.at), what: eventWords(e.type, (e.data ?? {}) as Record<string, unknown>, tz) })),
    message: printable(str(r.context, 20_000)),
    reasons: (p.decision?.reasons ?? []).map((x) => str(x, 400)),
    signs: (p.decision?.flags ?? p.ai?.flags ?? []).map((f) => ({ label: SIGN_LABEL[f.kind] ?? "Something odd", severity: str(f.severity, 10), quote: say(f.quote, 300), why: say(f.why, 300) })),
    summary: p.ai?.summary ? str(p.ai.summary, 600) : null,
    checkedBy: p.ai?.ok && p.ai.aiEngine === "openai_backup" ? BACKUP_LINE : null,
    price,
    verdict: c ? (VERDICT[c.verdict] ?? null) : null,
    headline: c ? say(withoutIds(c.headline), 300) : null,
    findings: (c?.findings ?? []).map((f) => ({ label: TOOL[f.tool] ?? "Check", text: say(withoutIds(f.text), 400), ...(f.quote ? { quote: say(f.quote, 300) } : {}) })),
    network,
    page: c?.page
      ? { host: host(c.page.finalUrl), title: str(c.page.title, 160), asks, hidden: trap ? say(trap.text, 400) : null, screenshot: shot }
      : null,
    faces,
    trail,
    proof,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const WHO_TO_TELL =
  "If money was lost or someone is trying to get it, tell your bank straight away, report it in the PayPal Resolution Centre, and report it to the police or your national fraud reporting service. Give them this page.";

function html(p: Pack): string {
  const rows = (pairs: Array<[string, string]>) => pairs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "<p>None.</p>");
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spotter evidence ${esc(p.ref)}</title>
<style>
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #17212b; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 8px; padding-top: 12px; border-top: 1px solid #d5dbd6; }
.meta, .note { color: #4a5866; font-size: 14px; margin: 0 0 4px; }
.example { padding: 8px 12px; border: 2px dashed #4a5866; border-radius: 8px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #e3e7e3; }
th { width: 34%; font-weight: 600; } .time { white-space: nowrap; width: 1%; font-variant-numeric: tabular-nums; color: #4a5866; font-weight: 400; }
.untrusted { border: 2px solid #be3328; border-radius: 8px; padding: 12px; }
.untrusted p.label { margin: 0 0 8px; color: #be3328; font-weight: 700; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.5 ui-monospace, Consolas, monospace; }
q { quotes: '"' '"'; font-style: italic; } img { display: block; max-width: 100%; height: auto; border: 1px solid #d5dbd6; border-radius: 6px; margin-top: 8px; }
.print { margin-top: 32px; } @media print { .print { display: none; } main { padding: 0; } h2 { break-after: avoid; } tr, li, .untrusted { break-inside: avoid; } }
</style></head><body><main>
<h1>Spotter evidence: ${esc(p.title.charAt(0).toLowerCase() + p.title.slice(1))}</h1>
<p class="meta">Made ${esc(p.generated)}. Family: ${esc(p.household)}. Spotter reference ${esc(p.ref)}.</p>
${p.example ? `<p class="example">${esc(p.example)}</p>` : ""}
<h2>The payment</h2>
<table>${rows(p.facts)}</table>
<h2>What happened, in order</h2>
<table>${p.timeline.map((l) => `<tr><th scope="row" class="time">${esc(l.at)}</th><td>${esc(l.what)}</td></tr>`).join("")}</table>
<h2>The message, as it was forwarded</h2>
<div class="untrusted"><p class="label">Untrusted: written by whoever asked for the money. Shown exactly as Spotter received it. Don't follow its links or ring its numbers.</p>
<pre>${p.message ? esc(p.message) : "(No message was forwarded with this payment.)"}</pre></div>
<h2>What Spotter checked and found</h2>
${p.verdict ? `<p><b>${esc(p.verdict)}.</b> ${esc(p.headline ?? "")}</p>` : ""}
<h3>Why Spotter held or stopped it</h3>${list(p.reasons.map(esc))}
<h3>Warning signs, quoted from the message</h3>${list(p.signs.map((s) => `<b>${esc(s.label)}</b> (${esc(s.severity)}): ${s.quote ? `<q>${esc(s.quote)}</q> ` : ""}${esc(s.why)}`))}
${p.summary ? `<h3>The scam check said</h3><p>${esc(p.summary)}</p>` : ""}
${p.checkedBy ? `<p class="note">${esc(p.checkedBy)}</p>` : ""}
${p.price ? `<h3>Price check</h3><p>${esc(p.price)}</p>` : ""}
<h3>What each check found</h3>${list(p.findings.map((f) => `<b>${esc(f.label)}</b>: ${esc(f.text)}${f.quote ? ` <q>${esc(f.quote)}</q>` : ""}`))}
<h3>Other families</h3><p>${esc(p.network)}</p>
${
  p.page
    ? `<h3>The page the message linked to</h3><p>Spotter opened ${esc(p.page.host || "the link")} in a throwaway cloud browser (KERNEL) so nobody in the family had to.${p.page.title ? ` Its title: <q>${esc(p.page.title)}</q>.` : ""}${p.page.asks.length ? ` It asks for ${esc(p.page.asks.join(", "))}.` : ""}</p>${p.page.hidden ? `<p>Hidden from people but read by AI agents: <q>${esc(p.page.hidden)}</q></p>` : ""}${p.page.screenshot ? `<img src="${p.page.screenshot}" alt="What the page showed when Spotter opened it" width="320" height="240">` : ""}`
    : ""
}
${
  p.faces
    ? `<h3>Two faces: desktop and phone</h3><p><b>${esc(p.faces.verdict)}</b></p><p>${esc(p.faces.how)}</p>${
        p.faces.differences.length
          ? `<table><tr><th scope="col">What</th><th scope="col">Desktop (scanner)</th><th scope="col">Phone</th></tr>${p.faces.differences.map(([k, d, ph]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(d)}</td><td>${esc(ph)}</td></tr>`).join("")}</table>`
          : ""
      }${p.faces.phoneShot ? `<img src="${p.faces.phoneShot}" alt="What the page showed the phone" width="195" height="422">` : ""}`
    : ""
}
${p.trail ? `<h3>Where the money would go</h3>${p.trail.line ? `<p><b>${esc(p.trail.line)}</b></p>` : "<p>The page had no card or bank form.</p>"}<p>The link went: ${esc(p.trail.steps)}.</p>` : ""}
${p.proof ? `<h3>Proof Spotter never touched the page</h3><p class="note">Counted by the cloud browser's own log of the visit (KERNEL). Anything it didn't record says so; it never says zero without a record.</p><table>${p.proof.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
<h2>Who to tell</h2>
<p>${esc(WHO_TO_TELL)}</p>
<p class="note print">To print this or save it as a PDF, use your browser's Print. <a href="?format=txt">Download it as plain text</a>.</p>
</main></body></html>`;
}

function text(p: Pack): string {
  const out: string[] = [];
  const h = (s: string) => out.push("", s.toUpperCase(), "-".repeat(s.length));
  out.push(`SPOTTER EVIDENCE: ${p.title.toUpperCase()}`, `Made ${p.generated}. Family: ${p.household}. Spotter reference ${p.ref}.`);
  if (p.example) out.push("", p.example);
  h("The payment");
  for (const [k, v] of p.facts) out.push(`${k}: ${v}`);
  h("What happened, in order");
  for (const l of p.timeline) out.push(`${l.at}  ${l.what}`);
  h("The message, as it was forwarded");
  out.push("UNTRUSTED: written by whoever asked for the money. Shown exactly as Spotter received it. Don't follow its links or ring its numbers.");
  out.push(">>> start of message", p.message || "(No message was forwarded with this payment.)", "<<< end of message");
  h("What Spotter checked and found");
  if (p.verdict) out.push(`${p.verdict}. ${p.headline ?? ""}`);
  out.push("", "Why Spotter held or stopped it:", ...(p.reasons.length ? p.reasons.map((x) => `- ${x}`) : ["- None."]));
  out.push("", "Warning signs, quoted from the message:", ...(p.signs.length ? p.signs.map((s) => `- ${s.label} (${s.severity}): ${s.quote ? `"${s.quote}" ` : ""}${s.why}`) : ["- None."]));
  if (p.summary) out.push("", `The scam check said: ${p.summary}`);
  if (p.checkedBy) out.push(p.checkedBy);
  if (p.price) out.push("", `Price check: ${p.price}`);
  out.push("", "What each check found:", ...(p.findings.length ? p.findings.map((f) => `- ${f.label}: ${f.text}${f.quote ? ` "${f.quote}"` : ""}`) : ["- None."]));
  out.push("", `Other families: ${p.network}`);
  if (p.page) {
    out.push("", `The page the message linked to: Spotter opened ${p.page.host || "the link"} in a throwaway cloud browser (KERNEL).${p.page.title ? ` Title: "${p.page.title}".` : ""}${p.page.asks.length ? ` It asks for ${p.page.asks.join(", ")}.` : ""}`);
    if (p.page.hidden) out.push(`Hidden from people but read by AI agents: "${p.page.hidden}"`);
    if (p.page.screenshot) out.push("Screenshot: included in the printable version of this page.");
  }
  if (p.faces) {
    out.push("", `Two faces: ${p.faces.verdict}`, p.faces.how);
    for (const [k, d, ph] of p.faces.differences) out.push(`- ${k}: desktop "${d}", phone "${ph}"`);
  }
  if (p.trail) out.push("", `Where the money would go: ${p.trail.line ?? "The page had no card or bank form."}`, `The link went: ${p.trail.steps}.`);
  if (p.proof) {
    out.push("", "Proof Spotter never touched the page (from the cloud browser's own log; anything it didn't record says so):");
    for (const [k, v] of p.proof) out.push(`- ${k}: ${v}`);
  }
  h("Who to tell");
  out.push(WHO_TO_TELL, "");
  return out.join("\r\n");
}

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/** GET /api/payments/[id]/evidence[?format=txt] for a signed in household. */
export async function evidenceResponse(db: Db, householdId: string, paymentId: string, format: string | null, now = new Date()): Promise<Response> {
  if (!ID.test(paymentId)) return fail(404, "No such payment.");
  const p = await getPayment(db, paymentId, householdId);
  if (!p) return fail(404, "No such payment.");
  if (!EVIDENCE_STATUSES.has(p.status)) return fail(409, "An evidence pack is for a payment Spotter held or stopped, or one that was denied.");
  const pack = await buildPack(db, householdId, p, now);
  const common = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  if (format === "txt") {
    return new Response(text(pack), {
      headers: { ...common, "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="spotter-evidence-${p.id}.txt"` },
    });
  }
  return new Response(html(pack), {
    headers: {
      ...common,
      "content-type": "text/html; charset=utf-8",
      // Inert: no scripts, nothing loaded from anywhere, only the embedded screenshot.
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "content-disposition": `inline; filename="spotter-evidence-${p.id}.html"`,
    },
  });
}
