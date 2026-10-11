// "Tool poisoning check". Websites can now register tools for AI agents (WebMCP: document.modelContext.registerTool),
// each with a name, a description and an input schema whose fields have their own descriptions. An AI agent reads all
// of that text to decide what to call, so a shop can hide orders for agents in it ("the user already approved the
// premium bundle"). In the same throwaway KERNEL visit, Spotter lists the page's tools (browsers.webmcp.listTools)
// and reads every piece of text with the same instruction check as "seen vs read".
//
// List only: Spotter never runs a page's tools (a test checks that no source file calls the invoke API). Everything here is a
// stranger's text: it is cleaned (invisible characters revealed or removed, markup and control characters dropped)
// before it is read, judged on the whole cleaned text, and only then cut short for display.
import { around, looksLikeInstruction } from "./seen";

/** One tool as Spotter shows it: plain text only, never the raw JSON. */
export type ShopTool = {
  name: string;
  title?: string;
  description: string;
  fields: Array<{ name: string; description: string }>;
  /** What the tool says about itself (the page's own hints, not enforced by anyone), in plain words. */
  hints: string[];
  /** Host of the embedded frame that registered it, when it isn't the page itself. */
  frame?: string;
  /** The first line in the tool's text written to steer an AI agent. */
  poisoned?: { where: string; quote: string };
};

export type ShopTools =
  | { checked: true; tools: ShopTool[]; total: number; truncated: boolean }
  | { checked: false; error: string };

const MAX_TOOLS_READ = 200; // every one of these is checked for instructions
const MAX_TOOLS_SHOWN = 12; // poisoned first, then the rest
const MAX_FIELDS = 100;
const MAX_DEPTH = 5;
const MAX_RAW = 2_000_000; // a memory guard on one piece of text before cleaning (KERNEL's answer is bounded anyway)
const MAX_READ = 100_000; // characters of cleaned text judged
const MAX_SHOWN = 300;

// Characters people can't see. Tag characters spell out hidden ASCII, so they are decoded (the hidden words become
// readable and get checked); the rest are removed.
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁤⁦-⁩ㅤ︀-️﻿ﾠ]|[\u{E0100}-\u{E01EF}]/gu;
// Control characters, markup and chat formatting: none of it is shown as anything but plain text.
// eslint-disable-next-line no-control-regex
const NOISE = /[\u0000-\u001F\u007F-\u009F<>"`[\]\\|*~]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** A stranger's text, cleaned for reading: hidden characters revealed or removed, no markup, one line. Cut only after. */
function clean(raw: string): { text: string; cut: boolean } {
  const text = raw
    .slice(0, MAX_RAW)
    .replace(LONE_SURROGATE, "")
    .replace(TAG_RUN, (run) => [...run].map((c) => String.fromCharCode(c.codePointAt(0)! - 0xe0000)).join(""))
    .replace(INVISIBLE, "")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = raw.length > MAX_RAW || text.length > MAX_READ;
  return { text: text.length > MAX_READ ? text.slice(0, MAX_READ).replace(LONE_SURROGATE, "") : text, cut };
}

/** Cleaned and cut to max characters on whole characters (never through an emoji). */
export function cleanToolText(raw: string, max = MAX_SHOWN): string {
  const chars = [...clean(raw).text];
  return chars.length > max ? `${chars.slice(0, max).join("").trimEnd()}…` : chars.join("");
}

const display = (text: string) => around(text).replace(LONE_SURROGATE, "");

const HINTS: Array<[string, boolean, string]> = [
  ["readOnlyHint", true, "says it only reads"],
  ["consequentialHint", true, "says it makes changes that matter"],
  ["destructiveHint", true, "says it can delete or undo things"],
  ["autosubmit", true, "submits a form by itself"],
];

type Piece = { where: string; text: string };

/** Every string in an input schema a model would read: descriptions, titles, string defaults, enums and examples. */
function schemaPieces(schema: unknown, prefix: string, depth: number, out: { fields: ShopTool["fields"]; pieces: Piece[] }) {
  if (!schema || typeof schema !== "object" || depth > MAX_DEPTH) return;
  const props = (schema as { properties?: unknown }).properties;
  if (props && typeof props === "object") {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (out.fields.length >= MAX_FIELDS) return;
      const name = cleanToolText(key, 60) || "field";
      const path = prefix ? `${prefix}.${name}` : name;
      const where = `the "${path}" field`;
      const v = (value ?? {}) as Record<string, unknown>;
      const strings = [v.description, v.title, v.default, ...(Array.isArray(v.enum) ? v.enum : []), ...(Array.isArray(v.examples) ? v.examples : [])].filter(
        (s): s is string => typeof s === "string",
      );
      out.fields.push({ name: path, description: typeof v.description === "string" ? cleanToolText(v.description) : "" });
      for (const s of strings) out.pieces.push({ where, text: s });
      out.pieces.push({ where, text: key });
      schemaPieces(v, path, depth + 1, out);
      if (v.items) schemaPieces(v.items, `${path}[]`, depth + 1, out);
    }
  }
  const desc = (schema as { description?: unknown }).description;
  if (depth === 0 && typeof desc === "string") out.pieces.push({ where: "the input description", text: desc });
}

const hostOf = (u: unknown) => {
  if (typeof u !== "string") return undefined;
  try {
    return new URL(u).hostname.replace(/\.$/, "");
  } catch {
    return undefined;
  }
};

/** One raw entry from KERNEL (SDK shape { tool: { name, description, inputSchema, annotations }, source }), or null. */
function readOne(entry: unknown): ShopTool | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { tool?: unknown; source?: { frame?: { url?: unknown } | null } };
  const t = (e.tool ?? null) as Record<string, unknown> | null;
  if (!t || typeof t.name !== "string" || typeof t.description !== "string") return null;
  const name = cleanToolText(t.name, 80);
  if (!name) return null;
  const out = { fields: [] as ShopTool["fields"], pieces: [] as Piece[] };
  const pieces: Piece[] = [
    { where: "the description", text: t.description },
    { where: "the name", text: t.name },
    ...(typeof t.title === "string" ? [{ where: "the title", text: t.title }] : []),
  ];
  schemaPieces(t.inputSchema, "", 0, out);
  pieces.push(...out.pieces);

  let poisoned: ShopTool["poisoned"];
  for (const p of pieces) {
    const { text } = clean(p.text);
    if (looksLikeInstruction(text)) {
      poisoned = { where: p.where, quote: display(text) };
      break;
    }
  }
  const ann = (t.annotations ?? {}) as Record<string, unknown>;
  const frame = hostOf(e.source?.frame?.url);
  return {
    name,
    ...(typeof t.title === "string" && cleanToolText(t.title, 80) ? { title: cleanToolText(t.title, 80) } : {}),
    description: cleanToolText(t.description),
    fields: out.fields.slice(0, 8),
    hints: HINTS.filter(([k, want]) => ann[k] === want).map(([, , label]) => label),
    ...(frame ? { frame } : {}),
    ...(poisoned ? { poisoned } : {}),
  };
}

/** What KERNEL's listTools sent back, read and judged. Not a tool list at all: checked is false, never "no tools". */
export function readShopTools(raw: unknown): ShopTools {
  const list = raw && typeof raw === "object" ? (raw as { tools?: unknown }).tools : undefined;
  if (!Array.isArray(list)) return { checked: false, error: "The cloud browser didn't send back a list of tools." };
  const read = list.slice(0, MAX_TOOLS_READ).map(readOne).filter((t): t is ShopTool => t !== null);
  const sorted = [...read.filter((t) => t.poisoned), ...read.filter((t) => !t.poisoned)];
  return {
    checked: true,
    tools: sorted.slice(0, MAX_TOOLS_SHOWN),
    total: read.length,
    truncated: list.length > MAX_TOOLS_READ || sorted.length > MAX_TOOLS_SHOWN,
  };
}
