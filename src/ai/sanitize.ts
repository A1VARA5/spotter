// Clean untrusted context before the model reads it: reveal what humans can't see, strip our own
// delimiters, then cap length. Clean first, then cut, so padding can't push the payload past the cut.

export const MAX_CONTEXT_CHARS = 12_000;
export type Hidden = { kind: "invisible_text" | "direction_override" | "zero_width" | "fake_delimiter"; text: string };

const DELIMITERS = /<\/?\s*(context|evidence|request|rules|system|message|email)\s*>/gi;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const DIRECTION = /[‪-‮⁦-⁩]/g;
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;

export function sanitizeContext(raw: string): { text: string; hidden: Hidden[]; truncated: boolean } {
  const hidden: Hidden[] = [];
  let text = raw ?? "";

  text = text.replace(TAG_RUN, (run) => {
    const decoded = [...run].map((c) => String.fromCharCode(c.codePointAt(0)! - 0xe0000)).join("");
    hidden.push({ kind: "invisible_text", text: decoded });
    return decoded;
  });
  if (DIRECTION.test(text)) hidden.push({ kind: "direction_override", text: "text direction was flipped" });
  text = text.replace(DIRECTION, "");
  if (ZERO_WIDTH.test(text)) hidden.push({ kind: "zero_width", text: "invisible spaces" });
  text = text.replace(ZERO_WIDTH, "");
  // Strip until stable, so nesting like "</cont</context>ext>" can't rebuild a delimiter.
  let stripped = text;
  do {
    text = stripped;
    stripped = text.replace(DELIMITERS, "");
  } while (stripped !== text);
  if (text !== raw && /<\/?\s*(context|evidence|request|rules|system|message|email)\s*>/i.test(raw)) {
    hidden.push({ kind: "fake_delimiter", text: "content tried to fake Spotter's own sections" });
  }

  const chars = [...text];
  const truncated = chars.length > MAX_CONTEXT_CHARS;
  return { text: truncated ? chars.slice(0, MAX_CONTEXT_CHARS).join("") : text, hidden, truncated };
}
