// "Was it you?" part one, pure: who a message claims to be from. The AI check reports it (claimed_sender), code
// keeps it only if its quote is really in the message, and code's own patterns fill in when the model misses it
// or is down. Matching the claim to a real person in the family is code too, and conservative: no match, no ask.
import { normName } from "./rules";
import type { Spender } from "./lifecycle";

export const RELATIONS = ["child", "grandchild", "partner", "sibling", "parent", "friend", "other"] as const;
export type Relation = (typeof RELATIONS)[number];
/** name: written in the message, never guessed. relation: to the reader ("child" when they call the reader Mum). */
export type Claim = { name: string | null; relation: Relation | null; quote: string };

export type Target = { kind: "spotter"; name: string } | { kind: "spender"; spenderId: string; name: string } | { kind: "example"; name: string };

// Words that follow "it's" or come before "here" with a capital letter but are never a person's name.
const NOT_NAMES = new Set(
  (
    "me mum mom mam mummy dad daddy your not just really urgent gran nan nana nanna grandma grandad grandpa granny here the a an so ok okay " +
    "fine now late time done over true important me. i spotter paypal click tap press sign start look right come details pay info more link " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december " +
    "christmas easter today tomorrow tonight morning bank hello hi hey dear sorry please thanks free sale new only all ready back"
  ).split(" "),
);

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const NAME_PATTERNS = [/\b(?:[Ii]t'?s|[Ii]t is|[Tt]his is)\s+([A-Z][a-z]{1,19})\b/g, /\b([A-Z][a-z]{1,19}) here\b/g];
const RELATION_PATTERNS: Array<[RegExp, Relation]> = [
  [/\byour (?:grandson|granddaughter|grandchild)\b/i, "grandchild"],
  [/\b(?:(?:hi|hey|hiya)\s+)?(?:gran|nan|nana|nanna|grandma|granny|grandad|grandpa)[,!.]?\s+(?:it'?s|it is)\s+me\b/i, "grandchild"],
  [/\b(?:(?:hi|hey|hiya)\s+)?(?:mum|mom|mam|mummy|dad|daddy)[,!.]?\s+(?:it'?s|it is)\s+me\b/i, "child"],
  [/\byour (?:son|daughter)\b/i, "child"],
  [/\b(?:hi|hey|hiya)\s+(?:mum|mom|mam|mummy|dad|daddy)\b/i, "child"],
];

/** Code's own reading. Quotes are cut from the original text, so they are always real. */
export function claimFromText(text: string): Claim | null {
  if (!text) return null;
  // Same length swap, so indices into it are indices into the original.
  const flat = text.replace(/[‘’]/g, "'");
  // The earliest real name wins, whichever pattern found it.
  const hits = NAME_PATTERNS.flatMap((re) => [...flat.matchAll(re)]).filter((m) => !NOT_NAMES.has(m[1]!.toLowerCase()));
  const first = hits.sort((a, b) => a.index! - b.index!)[0];
  const name = first ? first[1]! : null;
  const nameQuote = first ? text.slice(first.index!, first.index! + first[0].length) : "";
  let relation: Relation | null = null;
  let relQuote = "";
  for (const [re, rel] of RELATION_PATTERNS) {
    const m = re.exec(flat);
    if (m) {
      relation = rel;
      relQuote = text.slice(m.index, m.index + m[0].length);
      break;
    }
  }
  if (!name && !relation) return null;
  return { name, relation, quote: name ? nameQuote : relQuote };
}

/** The model's claim, kept only if its quote is in the message and any name it gives is written there too. */
export function groundClaim(c: Claim | null | undefined, text: string): Claim | null {
  if (!c) return null;
  const quote = (c.quote ?? "").trim();
  const hay = normalise(text);
  // Short on purpose: the quote is shown to the person asked, and it's untrusted text.
  if (!quote || quote.length > 120 || !hay.includes(normalise(quote))) return null;
  const name = c.name?.trim() || null;
  if (name) {
    if (!/^[\p{L}][\p{L}' -]{0,29}$/u.test(name)) return null;
    const esc = normalise(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(?:^|[^\\p{L}])${esc}(?:$|[^\\p{L}])`, "u").test(hay)) return null;
  }
  const relation = c.relation && (RELATIONS as readonly string[]).includes(c.relation) ? c.relation : null;
  if (!name && !relation) return null;
  return { name, relation, quote };
}

const firstName = (s: string) => normName(s).split(/\s+/)[0] ?? "";

/**
 * The real person a claim points at, or null. A name must fit exactly one person (the spotter, or someone in the
 * family who isn't the payer and isn't an AI agent). Without a name, only "your child" writing to an older relative
 * maps to the spotter, who looks after them. Anything else asks nobody.
 */
export function matchClaim(
  c: Claim,
  ctx: { household: { spotter_name: string }; spenders: Array<Pick<Spender, "id" | "name" | "kind">>; payer: Pick<Spender, "id" | "kind"> },
): Target | null {
  if (c.name) {
    const full = normName(c.name);
    const first = firstName(c.name);
    const fits = (n: string) => normName(n) === full || firstName(n) === first;
    const found: Target[] = [];
    if (fits(ctx.household.spotter_name)) found.push({ kind: "spotter", name: ctx.household.spotter_name });
    for (const s of ctx.spenders) {
      if (s.id === ctx.payer.id || s.kind === "agent") continue;
      if (fits(s.name)) found.push({ kind: "spender", spenderId: s.id, name: s.name });
    }
    return found.length === 1 ? found[0]! : null;
  }
  if (c.relation === "child" && ctx.payer.kind === "person") return { kind: "spotter", name: ctx.household.spotter_name };
  return null;
}
