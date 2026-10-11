// Internal ids never reach a person. The case agent's tools hand the model ids like "offer_1" so it can cite a listing,
// and fallback case files used to copy a tool's raw summary, so a card could read "offer_1: ... offer_2: ...". This
// turns such text back into plain words: a list of listings becomes "name for £x at shop; ...", an id inside a
// sentence becomes "the listing" or goes, and Spotter's own payment ids go.

const OFFER = String.raw`offer_[A-Za-z0-9]{1,24}`;
const LIST_ITEM = new RegExp(String.raw`(^|\s*\n\s*|\s+)${OFFER}:\s*`, "g");
const IN_BRACKETS = new RegExp(String.raw`\s*\((?:${OFFER})(?:\s*,\s*${OFFER})*\)`, "g");
const BARE_OFFER = new RegExp(String.raw`\b${OFFER}\b`, "g");
const PAYMENT_ID = /\s*\bpay_[a-z0-9]{8,}\b/g;

/** At most `max` characters, cut after the last whole sentence that fits; a word boundary and "…" when none does. */
export function upTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end > 0) return head.slice(0, end + 1);
  const space = head.slice(0, max - 1).lastIndexOf(" ");
  return `${head.slice(0, space > 0 ? space : max - 1)}…`;
}

export function withoutIds(text: string): string {
  return text
    .replace(LIST_ITEM, (_m, lead: string, offset: number) => (offset === 0 && lead === "" ? "" : "; "))
    .replace(/^;\s*/, "")
    .replace(IN_BRACKETS, "")
    .replace(BARE_OFFER, "the listing")
    .replace(PAYMENT_ID, "")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

/** 'The message says "it's Tom".' Only the quote's own closing full stops are dropped, so the line never ends '.".';
 * a question or exclamation mark stays, since the words are shown as a quote. */
export function messageSays(quote: string): string {
  const q = quote.trim();
  return `The message says "${q.replace(/\.+$/, "") || q}".`;
}
