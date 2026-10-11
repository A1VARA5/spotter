// The folded case file: what shows before "See the evidence". Pure, so the card, the drawer and the tests agree.
// - keyFacts: the three findings worth reading first; every other finding goes behind the fold (never both).
// - kernelLead: the one KERNEL catch (hidden orders, two faces, money going off site) shown open, since it's the proof.
// - realOne: a genuine listing from Channel3 the card can open, and the deny notice can name.
// - unsaidReasons: the rules engine's reasons minus the ones the case file already says.
import type { Case, Finding } from "@/agents/case";
import type { Flag } from "@/core/grounding";
import { marketSummary, type MarketResult } from "@/core/market";
import { rankedReasons } from "@/core/reasons";
import type { Payment } from "@/core/lifecycle";

const TOOL_RANK: Record<string, number> = {
  network_reports: 0,
  find_genuine_offer: 1,
  open_link: 2,
  inspect_shop: 2,
  payee_history: 3,
  check_links: 4,
  paypal_hold: 5,
};

/** Among the all clear lines, KERNEL having looked at the page says the most. */
const CLEAR_RANK: Record<string, number> = { inspect_shop: 0, open_link: 0, check_links: 1, network_reports: 2 };

/** "Nothing found" lines: worth knowing, but never ahead of a finding that is a reason to worry. */
const ALL_CLEAR = /\b(no other spotter famil|found nothing wrong|nothing wrong with|had no hidden text|no hidden (text|tricks|instructions)|couldn.t find|found no (exact )?(match|listing)|no (exact )?(match|listing)s? (was |were )?found)/i;
/** Other families' reports only lead when there are some. */
const NONE_REPORTED = /^no other spotter famil/i;

function rank(f: Finding): number {
  if (f.severity === "high") return -10;
  const clear = ALL_CLEAR.test(f.text) || (f.tool === "network_reports" && NONE_REPORTED.test(f.text));
  return clear ? 10 + (CLEAR_RANK[f.tool] ?? 3) : (TOOL_RANK[f.tool] ?? 6);
}

/** The three findings to read first, best first, and the rest in their original order. */
export function keyFacts(findings: Finding[], n = 3): { facts: Finding[]; rest: Finding[] } {
  const order = findings.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i);
  const top = new Set(order.slice(0, n).map((x) => x.i));
  return { facts: order.slice(0, n).map((x) => x.f), rest: findings.filter((_, i) => !top.has(i)) };
}

export type LeadKind = "seen" | "faces" | "trail" | "tools";
export type Lead = { kind: LeadKind; line: string };

/** Splits a lead line around its first "KERNEL" so the name can be set in bold wherever it sits in the sentence. */
export function leadParts(line: string): { before: string; name: string; after: string } {
  const at = line.indexOf("KERNEL");
  if (at < 0) return { before: line, name: "", after: "" };
  return { before: line.slice(0, at), name: "KERNEL", after: line.slice(at + "KERNEL".length) };
}

type Page = NonNullable<Case["page"]>;

/** The KERNEL catch to show open first, with the engine's name and what it proves in one line. Null when it caught nothing. */
export function kernelLead(page: Page | undefined | null): Lead | null {
  if (!page) return null;
  if (page.seen?.hidden.some((h) => h.instruction)) return { kind: "seen", line: "The cloud browser (KERNEL) read text on this page that people can't see, written to give your AI agent orders." };
  if (page.faces?.compared && page.faces.differs) return { kind: "faces", line: "KERNEL opened this link as a desktop and as a phone at the same moment, and the page showed them different things." };
  if (page.trail?.offsite) return { kind: "trail", line: `The cloud browser (KERNEL) saw where the money goes: ${page.trail.line ?? "card details leave this shop's own site."}` };
  if (page.tools?.checked && page.tools.tools.some((t) => t.poisoned)) return { kind: "tools", line: "The cloud browser (KERNEL) found a tool on this page written to steer your AI agent." };
  return null;
}

/** exact: the case's own offer, checked to be the same product. Otherwise the market check's cheapest real listing. */
export type RealOne = { title: string; domain: string; price: number; url: string; exact: boolean };

const HTTPS = /^https:\/\/[^\s"<>]+$/;

/**
 * A genuine listing to open instead: the case's own Channel3 offer when it has one (so the swap names the same shop),
 * else the market check's cheapest real shop. Only plain https links; nothing that isn't a Channel3 listing.
 */
export function realOne(c: Pick<Case, "swap"> | null | undefined, market: (MarketResult & { item?: string }) | null | undefined): RealOne | null {
  const s = c?.swap;
  if (s && HTTPS.test(s.url) && s.price > 0) return { title: s.title, domain: s.domain, price: s.price, url: s.url, exact: true };
  const cheap = marketSummary(market)?.cheapest;
  if (cheap && HTTPS.test(cheap.url) && cheap.price > 0) return { title: cheap.title, domain: cheap.domain, price: cheap.price, url: cheap.url, exact: false };
  return null;
}

/**
 * The reasons a held card lists under the case file, without the ones the first view already says: price reasons when
 * Channel3's prices are one of the three facts, "First time paying" when the family history finding is, and hidden
 * orders when KERNEL's "seen vs read" panel is open. Anything else (the allowance, a rule) always stays.
 */
export function unsaidReasons(reasons: string[], flags: Flag[], c: Pick<Case, "findings" | "page"> | null | undefined, opts: { lead: LeadKind | null }): string[] {
  if (!c) return reasons;
  // The same three facts the card shows: findings an evidence panel already shows aren't among them.
  const shown = new Set(keyFacts(c.findings.filter((f) => !panelShows(f, c.page))).facts.map((f) => f.tool));
  const said = new Set<string>();
  for (const fl of flags) {
    if (fl.kind === "price" && shown.has("find_genuine_offer")) said.add(fl.why);
    if (fl.kind === "prompt_injection" && opts.lead === "seen") said.add(fl.why);
  }
  return reasons.filter((r) => !said.has(r) && !(shown.has("payee_history") && /^First time paying /.test(r)));
}

/**
 * True when one of the evidence panels already shows this code made finding (two faces, the money trail, the hidden
 * line, a poisoned tool), so the list doesn't say it a second time. The finding still goes to alerts and the pack.
 */
export function panelShows(f: Finding, page: Case["page"]): boolean {
  if (!page || !f.kind) return false;
  if (f.kind === "cloaking") return !!page.faces;
  if (f.kind === "money_offsite") return !!page.trail;
  if (f.toolName) return !!(page.tools?.checked && page.tools.total > 0 && page.tools.tools.some((t) => t.name === f.toolName));
  return !!(page.seen && page.seen.hidden.some((h) => h.instruction));
}

/**
 * The Why list in the Activity drawer: the strongest reason first, always (src/core/reasons.ts), then the other reasons
 * the case file doesn't already say, strongest first.
 */
export function whyLines(p: Pick<Payment, "decision" | "ai" | "case_file"> & Partial<Pick<Payment, "status" | "decided_by" | "tripwire">>): string[] {
  const c = p.case_file;
  const ranked = rankedReasons({ decision: p.decision, case_file: c, status: p.status, decided_by: p.decided_by, tripwire: p.tripwire });
  if (!ranked.length) return [];
  const unsaid = new Set(unsaidReasons(p.decision?.reasons ?? [], p.decision?.flags ?? p.ai?.flags ?? [], c, { lead: kernelLead(c?.page)?.kind ?? null }));
  return ranked.filter((r, i) => i === 0 || unsaid.has(r));
}
