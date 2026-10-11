// Sponsor names are never possessive in anything a person reads: "Real shop prices (Channel3)", "checked with
// Channel3", "the cloud browser (KERNEL)". Comments and logs may say what they like; the landing has its own owner.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const SKIP = [join(ROOT, "app", "landing"), join(ROOT, "app", "page.tsx"), join(ROOT, "paypal")];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (SKIP.some((s) => p.startsWith(s))) return [];
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Drops comments and console lines, keeping the strings and JSX a person can read. */
const readable = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|--)/.test(l) && !/console\.(error|warn|log)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");

describe("brand wording", () => {
  it("never writes Channel3's or KERNEL's in text people read", () => {
    const hits = files(ROOT).flatMap((f) =>
      readable(readFileSync(f, "utf8"))
        .split("\n")
        .filter((l) => /(Channel3|KERNEL)(&apos;|'|’)s\b/.test(l))
        .map((l) => `${f.slice(ROOT.length)}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});
