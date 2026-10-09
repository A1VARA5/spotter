// Spotter's email look. Email clients need tables and inline styles, no SVG and no external CSS, so this is
// old-fashioned on purpose. Everything that came from a message is escaped before it goes in.
import { findQuotes } from "@/ui/format";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INK = "#17212b";
const INK2 = "#4a5866";
const LINE = "#d5dbd6";
const HOLD = "#f2b705";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type Tone = "held" | "stopped" | "paid" | "info";
const TONE: Record<Tone, { bg: string; fg: string; label: string }> = {
  held: { bg: "#fff4cc", fg: "#7a5a00", label: "On hold at PayPal" },
  stopped: { bg: "#fbe4e1", fg: "#9c2a21", label: "Stopped" },
  paid: { bg: "#e3f2ea", fg: "#1f7a55", label: "Paid" },
  info: { bg: "#e8edf6", fg: "#2c55c9", label: "Spotter" },
};

/** The message text with the quoted warning words highlighted, safely. */
export function markedText(text: string, quotes: Array<{ quote: string; high: boolean }>): string {
  const t = text.slice(0, 900);
  const ranges = findQuotes(t, quotes.map((q) => q.quote));
  let out = "";
  let at = 0;
  for (const r of ranges) {
    out += esc(t.slice(at, r.start));
    const high = quotes[r.i]!.high;
    out += `<span style="background:${high ? "#fbe0dc" : "#fff1c2"};border-bottom:2px solid ${high ? "#be3328" : HOLD};padding:0 2px">${esc(t.slice(r.start, r.end))}</span>`;
    at = r.end;
  }
  return out + esc(t.slice(at)) + (text.length > t.length ? "…" : "");
}

export function layout(o: { site: string; preheader: string; tone: Tone; eyebrow: string; headline: string; sub?: string; body: string; cta?: { label: string; href: string; note?: string } }): string {
  const tone = TONE[o.tone];
  const cta = o.cta
    ? `<tr><td style="padding:8px 28px 4px"><a href="${esc(o.cta.href)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font:600 16px ${FONT};padding:14px 22px;border-radius:12px">${esc(o.cta.label)}</a>${
        o.cta.note ? `<p style="margin:10px 0 0;font:14px ${FONT};color:${INK2}">${esc(o.cta.note)}</p>` : ""
      }</td></tr>`
    : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#eef1ed">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1ed;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${LINE}">
<tr><td style="background:#0d141c;padding:16px 28px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td><img src="${esc(o.site)}/apple-icon" width="28" height="28" alt="" style="display:block;border-radius:8px"></td>
    <td style="padding-left:10px;font:700 17px ${FONT};color:#ffffff">Spotter</td>
  </tr></table>
</td></tr>
<tr><td style="padding:26px 28px 6px">
  <span style="display:inline-block;background:${tone.bg};color:${tone.fg};font:700 12px ${FONT};padding:5px 10px;border-radius:999px">${esc(o.eyebrow || tone.label)}</span>
  <h1 style="margin:14px 0 6px;font:700 26px/1.2 ${FONT};color:${INK};letter-spacing:-0.3px">${esc(o.headline)}</h1>
  ${o.sub ? `<p style="margin:0;font:16px/1.5 ${FONT};color:${INK2}">${esc(o.sub)}</p>` : ""}
</td></tr>
${o.body}
${cta}
<tr><td style="padding:22px 28px 26px"><p style="margin:0;padding-top:16px;border-top:1px solid ${LINE};font:13px/1.5 ${FONT};color:${INK2}">Spotter puts a second look between your family, their AI agents and PayPal. This runs on the PayPal sandbox: no real money moves.</p></td></tr>
</table></td></tr></table></body></html>`;
}

/** A row: label on top, content under it. */
export function block(label: string, html: string): string {
  return `<tr><td style="padding:14px 28px 4px"><p style="margin:0 0 8px;font:600 13px ${FONT};color:${INK2}">${esc(label)}</p>${html}</td></tr>`;
}

export function list(items: string[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${items
    .map((r) => `<tr><td width="18" valign="top" style="font:15px ${FONT};color:${HOLD};padding:2px 0">●</td><td style="font:15px/1.45 ${FONT};color:${INK};padding:2px 0 6px">${esc(r)}</td></tr>`)
    .join("")}</table>`;
}

export function quoteBox(html: string): string {
  return `<div style="background:#f5f7f4;border:1px solid ${LINE};border-radius:12px;padding:12px 14px;font:15px/1.55 ${FONT};color:${INK}">${html}</div>`;
}

/** The hold track, drawn with a table: who, the money at the checkpoint, to whom. */
export function track(from: string, amount: string, to: string, tone: Tone): string {
  const t = TONE[tone];
  return `<tr><td style="padding:16px 28px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px"><tr>
<td style="padding:12px 14px;font:600 14px ${FONT};color:${INK}">${esc(from)}</td>
<td align="center" style="padding:12px 6px"><span style="display:inline-block;background:${t.bg};color:${t.fg};font:700 15px ${FONT};padding:6px 12px;border-radius:999px">${esc(amount)}</span></td>
<td align="right" style="padding:12px 14px;font:600 14px ${FONT};color:${INK};word-break:break-all">${esc(to)}</td>
</tr></table></td></tr>`;
}

/** Plain paragraphs as an email (for replies to people who forwarded something). */
export function simple(site: string, tone: Tone, eyebrow: string, headline: string, paras: string[]): string {
  return layout({ site, preheader: paras[0] ?? headline, tone, eyebrow, headline, body: paras.map((p) => `<tr><td style="padding:8px 28px 0"><p style="margin:0;font:16px/1.55 ${FONT};color:${INK}">${esc(p)}</p></td></tr>`).join("") });
}
