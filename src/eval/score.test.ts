import { describe, expect, it } from "vitest";
import { score } from "./score";

describe("scam check eval scoring", () => {
  it("counts a flagged scam as caught, a flagged normal text as a false alarm", () => {
    const s = score([
      { label: "scam", flagged: true },
      { label: "scam", flagged: true },
      { label: "scam", flagged: false },
      { label: "normal", flagged: false },
      { label: "normal", flagged: true },
    ]);
    expect(s).toMatchObject({ scams: 3, normals: 2, caught: 2, missed: 1, falseAlarms: 1, failed: 0 });
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.falseAlarmRate).toBeCloseTo(1 / 2);
  });

  it("a check that failed to run counts as failed, never as a pass or a catch", () => {
    const s = score([{ label: "scam", flagged: null }, { label: "normal", flagged: null }, { label: "scam", flagged: true }]);
    expect(s).toMatchObject({ caught: 1, missed: 0, falseAlarms: 0, failed: 2 });
    expect(s.recall).toBe(1);
  });

  it("no flags at all: precision is null (nothing to be precise about), not 100%", () => {
    const s = score([{ label: "scam", flagged: false }, { label: "normal", flagged: false }]);
    expect(s.precision).toBeNull();
    expect(s.recall).toBe(0);
  });
});
