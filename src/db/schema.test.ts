import { describe, expect, it } from "vitest";
import { DDL } from "./schema";

// Neon runs the schema one statement at a time, split on ";" (src/db/index.ts), while PGlite runs it whole.
// A ";" inside a comment splits a statement in half on Neon only, so production breaks while every local test passes.
describe("schema DDL", () => {
  it("has no semicolon inside a comment", () => {
    const bad = DDL.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => /--.*;/.test(l));
    expect(bad).toEqual([]);
  });

  it("splits into statements that each start with SQL, not comment leftovers", () => {
    const stmts = DDL.split(";").map((s) => s.replace(/--[^\n]*/g, "").trim()).filter(Boolean);
    for (const s of stmts) expect(s).toMatch(/^(create|alter|drop|insert|update|do|comment)\b/i);
  });
});
