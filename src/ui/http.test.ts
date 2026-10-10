import { describe, expect, it } from "vitest";
import { plainError } from "./http";

describe("plainError", () => {
  it("keeps Spotter's own messages", () => {
    expect(plainError(new Error("Spotter found no safer option for this payment."))).toBe("Spotter found no safer option for this payment.");
  });

  it("never shows a raw JavaScript error", () => {
    for (const e of [new TypeError("Cannot read properties of undefined (reading 'status')"), new TypeError("x is not a function"), "boom", null]) {
      const m = plainError(e);
      expect(m).not.toMatch(/undefined|properties|function|boom/);
      expect(m).toMatch(/\.$/);
    }
  });

  it("says plainly when Spotter couldn't be reached", () => {
    expect(plainError(new TypeError("Failed to fetch"))).toMatch(/couldn't reach Spotter/i);
    expect(plainError(new TypeError("NetworkError when attempting to fetch resource."))).toMatch(/couldn't reach Spotter/i);
  });
});
