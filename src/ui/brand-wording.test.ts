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

  // Watchtower (src/watchtower, src/app/watchtower) has its own owner and is checked there; everywhere else in the
  // app, AG Studio is never possessive either ("from the AG Studio record", not "AG Studio's record").
  const WATCHTOWER = [join(ROOT, "watchtower"), join(ROOT, "app", "watchtower")];
  it("never writes AG Studio's in text people read", () => {
    const hits = files(ROOT)
      .filter((f) => !WATCHTOWER.some((w) => f.startsWith(w)))
      .flatMap((f) =>
        readable(readFileSync(f, "utf8"))
          .split("\n")
          .filter((l) => /AG Studio(&apos;|'|’)s\b/.test(l))
          .map((l) => `${f.slice(ROOT.length)}: ${l.trim()}`),
      );
    expect(hits).toEqual([]);
  });

  it("catches AG Studio's in every spelling a page can use", () => {
    for (const l of ["AG Studio's record", "AG Studio&apos;s record", "AG Studio’s record"]) expect(/AG Studio(&apos;|'|’)s\b/.test(l)).toBe(true);
    expect(/AG Studio(&apos;|'|’)s\b/.test("the AG Studio record")).toBe(false);
  });

  it("never writes AG Studio's or PayPal's Agent Toolkit in the landing, Watchtower or the agent lab", () => {
    const dirs = ["landing", "watchtower", "agent-lab"].map((d) => join(ROOT, "app", d));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
      });
    const hits = [...dirs.flatMap(walk), join(ROOT, "app", "page.tsx")].flatMap((f) =>
      readable(readFileSync(f, "utf8"))
        .split("\n")
        .filter((l) => /AG Studio(&apos;|'|’)s\b|PayPal(&apos;|'|’)s (Agent Toolkit|agent tools|toolkit)/.test(l))
        .map((l) => `${f.slice(ROOT.length)}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});
