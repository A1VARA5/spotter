import { describe, expect, it } from "vitest";
import { FACE_SIZE, padBox } from "./facesBox";

// Round 8 R8-N2: the outline was drawn on the form's own edge, so its stroke covered the first letter of every label.
describe("padBox: the form outline sits around the form with a small gap", () => {
  const form = { x: 37 / 390, y: 471 / 844, w: 316 / 390, h: 373 / 844 };

  it("grows the box outward by the same number of screen pixels on every side", () => {
    const b = padBox(form, FACE_SIZE.phone, 8);
    expect(b.x * 390).toBeCloseTo(29);
    expect(b.y * 844).toBeCloseTo(463);
    expect((b.x + b.w) * 390).toBeCloseTo(361);
    expect(b.w * 390).toBeCloseTo(332);
  });

  it("never leaves the picture", () => {
    const edge = { x: 0.005, y: 0.9, w: 0.99, h: 0.2 };
    const b = padBox(edge, FACE_SIZE.desktop, 8);
    expect(b.x).toBe(0);
    expect(b.x + b.w).toBeLessThanOrEqual(1);
    expect(b.y + b.h).toBeLessThanOrEqual(1);
    expect(b.y).toBeCloseTo(0.9 - 8 / 600);
  });

  it("knows the size of each face's screen (the KERNEL viewports)", () => {
    expect(FACE_SIZE).toEqual({ phone: { width: 390, height: 844 }, desktop: { width: 800, height: 600 } });
  });
});
