// Agentboxd email: Spotter's inbox (spotter@homingbox.net). Webhook verification and sender checks are ported
// from Red Flag (github.com/A1VARA5/redflag), Aivaras's own scam checker, where they were attacked on purpose.
import { createHmac, timingSafeEqual } from "node:crypto";
import { parse } from "tldts";

const API = "https://api.agentboxd.com/v1";

export type MailMessage = {
  id: string;
  thread_id?: string;
  from?: string | { address?: string; email?: string; name?: string };
  subject?: string;
  text?: string | null;
  html?: string | null;
  extracted_text?: string | null;
  labels?: string[];
  headers?: Record<string, string | string[]>;
  ai?: { risk?: { injection?: number; phishing?: number } };
};

export type MailEvent = { id: string; type: string; data?: { inbox?: { id: string; address?: string }; message?: MailMessage } };

/** HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook secret, within 5 minutes. */
export function verifyMailroom(raw: string, ts: string | null, sig: string | null): boolean {
  const secret = process.env.AGENTBOXD_WEBHOOK_SECRET;
  if (!secret || !ts || !sig) return false;
  const sent = Number(ts);
  if (!Number.isFinite(sent) || Math.abs(Date.now() / 1000 - sent) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex"));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function senderOf(m: Pick<MailMessage, "from">): string {
  const f = m.from;
  if (!f) return "";
  if (typeof f === "string") {
    const s = f.slice(0, 500);
    // The last <...> is the address; an earlier one can sit inside the display name ("<ceo@bank.com>" <x@y>).
    return (s.match(/<([^<>]+)>\s*$/)?.[1] ?? s).trim().toLowerCase();
  }
  return (f.address ?? f.email ?? "").trim().toLowerCase();
}

// Anyone can put any address in "From". Before trusting a sender, check that the sending server proved it may
// send for that address: DMARC pass, or a DKIM or SPF pass for the same domain as the From address.
export function senderVerified(m: Pick<MailMessage, "headers" | "labels" | "from">): boolean {
  if (m.labels?.some((l) => /spoof/i.test(l))) return false
  const fromDomain = parse(senderOf(m).split('@')[1] ?? '').domain
  if (!fromDomain) return false
  // Only the top Authentication-Results header is from our mail server; any below it came with the email.
  const header = Object.entries(m.headers ?? {}).find(([k]) => k.toLowerCase() === 'authentication-results')?.[1]
  const auth = (Array.isArray(header) ? header[0] : header) ?? ''
  // It must be the one our mail server wrote (it names itself first), not one the sender added.
  if (!/^\s*mx\.agentboxd\.com\s*(;|$)/i.test(auth)) {
    if (auth) console.warn('[email] Authentication-Results not from mx.agentboxd.com:', JSON.stringify(auth.slice(0, 80)))
    return false
  }
  // One result per ";" section, after the server's name. Comments in brackets are dropped, and each section is
  // read from its start, so "smtp.mailfrom=dmarc=pass@x" or "(dmarc=pass)" can't pose as a result.
  const results = auth
    .replace(/\([^()]*\)/g, ' ')
    .split(';')
    .map((r) => r.trim())
    .filter((r, i) => i > 0 || r.includes('='))
  const result = (method: string) => results.find((r) => r.toLowerCase().startsWith(method + '='))
  const passes = (r: string | undefined) => Boolean(r && /^\w+=pass\b/i.test(r))
  const aligned = (d: string | undefined) => Boolean(d) && parse(d!.toLowerCase()).domain === fromDomain
  const dmarc = result('dmarc')
  if (dmarc && /^dmarc=fail\b/i.test(dmarc)) return false
  if (passes(dmarc)) {
    const headerFrom = /\bheader\.from=([^\s;]+)/i.exec(dmarc!)?.[1]
    return !headerFrom || aligned(headerFrom)
  }
  const dkim = results.filter((r) => passes(r) && /^dkim=/i.test(r)).map((r) => /\bheader\.(?:d=|i=[^@\s;]*@)([^\s;]+)/i.exec(r)?.[1])
  const spf = result('spf')
  const spfDomain = passes(spf) ? /\bsmtp\.mailfrom=(?:[^@\s;]*@)?([^\s;]+)/i.exec(spf!)?.[1] : undefined
  return dkim.some(aligned) || aligned(spfDomain)
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const idPath = (id: string) => {
  if (!SAFE_ID.test(id)) throw new Error("Unexpected id from the mail provider");
  return encodeURIComponent(id);
};
const headers = () => ({ Authorization: `Bearer ${process.env.AGENTBOXD_API_KEY}`, "content-type": "application/json" });

export async function getMessage(id: string): Promise<MailMessage | null> {
  const r = await fetch(`${API}/messages/${idPath(id)}`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as MailMessage & { data?: MailMessage };
  return j.id ? j : (j.data ?? null);
}

/** Replies in the same thread. The idempotency key stops a retried webhook from replying twice. */
export async function reply(inboxId: string, messageId: string, text: string, html: string): Promise<void> {
  const r = await fetch(`${API}/inboxes/${idPath(inboxId)}/messages/${idPath(messageId)}/reply`, {
    method: "POST",
    headers: { ...headers(), "Idempotency-Key": `reply-${messageId}` },
    body: JSON.stringify({ text, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Agentboxd reply failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export async function send(to: string, subject: string, text: string, html: string, key: string): Promise<void> {
  const inbox = process.env.AGENTBOXD_INBOX_ID;
  if (!inbox) throw new Error("AGENTBOXD_INBOX_ID is not set.");
  const r = await fetch(`${API}/inboxes/${idPath(inbox)}/messages/send`, {
    method: "POST",
    headers: { ...headers(), "Idempotency-Key": key },
    body: JSON.stringify({ to, subject, text, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Agentboxd send failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/** Plain text from an email's HTML: links keep their real target in front of the label. */
export function htmlToText(html: string): string {
  return html
    .slice(0, 200_000)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<a\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)[^>]*>/gi, " ($1) ")
    .replace(/<[^<>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
