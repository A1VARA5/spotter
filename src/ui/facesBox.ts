// Where the two faces outline goes. The card form's box comes in fractions of the screenshot (src/agents/kernel.ts
// measures it on KERNEL's screen), so padding is added in those units: the same number of screen pixels on every side,
// whatever size the picture is drawn at, so the outline frames the form instead of cutting its labels.

export type Box = { x: number; y: number; w: number; h: number };

/** The screens KERNEL opens the two faces on (kernel.ts: PHONE, and the desktop's setViewportSize). */
export const FACE_SIZE = { phone: { width: 390, height: 844 }, desktop: { width: 800, height: 600 } } as const;

/** The box grown outward by `px` screen pixels on each side, kept inside the picture. */
export function padBox(box: Box, screen: { width: number; height: number }, px: number): Box {
  const dx = px / screen.width;
  const dy = px / screen.height;
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return { x, y, w: Math.min(1, box.x + box.w + dx) - x, h: Math.min(1, box.y + box.h + dy) - y };
}
