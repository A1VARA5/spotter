// "Tool poisoning check". Websites can now register tools for AI agents (WebMCP: document.modelContext.registerTool),
// each with a name, a description and an input schema whose fields have their own descriptions. An AI agent reads all
// of that text to decide what to call, so a shop can hide orders for agents in it ("the user already approved the
// premium bundle"). In the same throwaway KERNEL visit, Spotter lists the page's tools (browsers.webmcp.listTools)
// and reads every piece of text with the same instruction check as "seen vs read".
//
// List only: Spotter never runs a page's tools (a test checks that no source file calls the invoke API). Everything here is a
// stranger's text: it is cleaned (invisible characters revealed or removed, markup and control characters dropped)
// before it is read, judged on the whole cleaned text, and only then cut short for display. Whenever a limit stops
// Spotter reading everything, the result says so (incomplete), so a partial check never reads as a clean one.
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
  | {
      checked: true;
      /** Poisoned first, then the rest, at most MAX_TOOLS_SHOWN. */
      tools: ShopTool[];
      /** Every entry the page offered, read or not. */
      total: number;
      /** How many tools were poisoned among those read (some may not be in tools). */
      poisoned: number;
      /** A limit stopped Spotter reading everything (too many tools, fields or text, or entries it couldn't read). */
      incomplete: boolean;
    }
  | { checked: false; error: string };

const MAX_TOOLS_READ = 200; // every one of these is checked for instructions
const MAX_TOOLS_SHOWN = 12; // poisoned first, then the rest
const MAX_STRINGS = 600; // strings read per tool, anywhere in its schemas
const MAX_DEPTH = 8;
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
type Walk = { pieces: Piece[]; incomplete: boolean };

/**
 * Every string anywhere in a schema (descriptions, titles, defaults, enums, examples, const, patterns, anyOf branches,
 * $defs, property names...), labelled with the field it belongs to. A model reads all of it, so all of it is checked.
 */
function walkStrings(value: unknown, where: string, depth: number, out: Walk) {
  if (out.pieces.length >= MAX_STRINGS || depth > MAX_DEPTH) {
    if (value !== null && typeof value === "object") out.incomplete = true;
    else if (typeof value === "string") out.incomplete = true;
    return;
  }
  if (typeof value === "string") {
    out.pieces.push({ where, text: value });
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, where, depth + 1, out);
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    // A property's name and everything under it belong to that field.
    if ((key === "properties" || key === "patternProperties") && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [prop, sub] of Object.entries(v as Record<string, unknown>)) {
        const field = `the "${cleanToolText(prop, 60) || "field"}" field`;
        walkStrings(prop, field, depth + 1, out);
        walkStrings(sub, field, depth + 1, out);
      }
      continue;
    }
    walkStrings(v, where, depth + 1, out);
  }
}

/** The input schema's top level fields, for display. */
function fieldsOf(schema: unknown): ShopTool["fields"] {
  const props = schema && typeof schema === "object" ? (schema as { properties?: unknown }).properties : undefined;
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  return Object.entries(props as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, v]) => {
      const d = v && typeof v === "object" ? (v as { description?: unknown }).description : undefined;
      return { name: cleanToolText(key, 60) || "field", description: typeof d === "string" ? cleanToolText(d) : "" };
    });
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
function readOne(entry: unknown): { tool: ShopTool; incomplete: boolean } | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { tool?: unknown; source?: { frame?: { url?: unknown } | null } };
  const t = (e.tool ?? null) as Record<string, unknown> | null;
  if (!t || typeof t !== "object") return null;
  const name = typeof t.name === "string" ? cleanToolText(t.name, 80) : "";
  const description = typeof t.description === "string" ? t.description : "";
  const out: Walk = { pieces: [], incomplete: false };
  walkStrings(t.description, "the description", 0, out);
  walkStrings(t.name, "the name", 0, out);
  walkStrings(t.title, "the title", 0, out);
  walkStrings(t.inputSchema, "the input schema", 0, out);
  walkStrings(t.outputSchema, "the output schema", 0, out);

  let poisoned: ShopTool["poisoned"];
  let incomplete = out.incomplete || !name;
  for (const p of out.pieces) {
    const { text, cut } = clean(p.text);
    if (cut) incomplete = true;
    if (!poisoned && looksLikeInstruction(text)) poisoned = { where: p.where, quote: display(text) };
  }
  const ann = (t.annotations ?? {}) as Record<string, unknown>;
  const frame = hostOf(e.source?.frame?.url);
  const title = typeof t.title === "string" ? cleanToolText(t.title, 80) : "";
  return {
    incomplete,
    tool: {
      name: name || "unnamed tool",
      ...(title ? { title } : {}),
      description: cleanToolText(description),
      fields: fieldsOf(t.inputSchema),
      hints: HINTS.filter(([k, want]) => ann[k] === want).map(([, , label]) => label),
      ...(frame ? { frame } : {}),
      ...(poisoned ? { poisoned } : {}),
    },
  };
}

/** What KERNEL's listTools sent back, read and judged. Not a tool list at all: checked is false, never "no tools". */
export function readShopTools(raw: unknown): ShopTools {
  const list = raw && typeof raw === "object" ? (raw as { tools?: unknown }).tools : undefined;
  if (!Array.isArray(list)) {
    console.error(`[spotter] the cloud browser's tool list wasn't a list (got ${raw === null ? "null" : typeof raw}${raw && typeof raw === "object" ? ` with keys ${Object.keys(raw).slice(0, 5).join(", ")}` : ""})`);
    return { checked: false, error: "The cloud browser didn't send back a list of tools." };
  }
  const results = list.slice(0, MAX_TOOLS_READ).map(readOne);
  const read = results.filter((r): r is NonNullable<typeof r> => r !== null);
  const tools = read.map((r) => r.tool);
  const poisoned = tools.filter((t) => t.poisoned);
  const skipped = results.length - read.length;
  return {
    checked: true,
    tools: [...poisoned, ...tools.filter((t) => !t.poisoned)].slice(0, MAX_TOOLS_SHOWN),
    total: list.length,
    poisoned: poisoned.length,
    incomplete: list.length > MAX_TOOLS_READ || skipped > 0 || read.some((r) => r.incomplete),
  };
}
