import { describe, expect, it } from "vitest";
import { photoChip } from "./PhotoCheck";

// The chip over a photo check result follows which way the verdict went: an overpriced quote is never "far below".
describe("the photo check's verdict chip", () => {
  it("names the direction of the verdict", () => {
    expect(photoChip({ verdictKind: "far_below", fallback: false })).toBe("Far below real shops");
    expect(photoChip({ verdictKind: "well_over", fallback: false })).toBe("Well over real shops");
    expect(photoChip({ verdictKind: "under_used", fallback: false })).toBe("Well under used prices");
  });

  it("says the prices are rough when only the whole photo could be searched", () => {
    expect(photoChip({ verdictKind: null, fallback: true })).toMatch(/Rough prices/);
    expect(photoChip({ verdictKind: null, fallback: false })).toBe("Real shop prices");
  });
});
