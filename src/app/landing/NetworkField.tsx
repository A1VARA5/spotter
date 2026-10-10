"use client";
// The Spotter network, drawn behind the dark heroes. A quiet lattice of dots, one dot per family, densest behind
// the devices and thinning out towards the edges. Now and then a family's payment goes through (a green blink).
// Less often a family stops a scam: a red pulse, then a hairline ring spreads out and some of the families it
// passes blink amber, because they've now been warned about that payee. That's the real network feature.
//
// Performance: one canvas at the device pixel ratio (capped at 2, 1.5 on phones). The lattice is drawn once per resize into an
// offscreen layer that becomes the canvas's own background image, so frames only clear and redraw the small box
// around the few lit dots and rings, and skip drawing entirely when nothing is lit. All state lives in typed
// arrays sized on resize, so frames allocate nothing. Paused off screen and in hidden tabs, a still frame
// for reduced motion, fewer dots and events on small screens. Decorative: hidden from assistive tech.
import { useEffect, useRef } from "react";

const DOT = "#8c9aa8";
const AMBER = "#f2b705";
const RED = "#be3328";
const GREEN = "#1f7a55";
const RINGS = 3;

// A stable pseudo random number per lattice cell, so the pattern doesn't reshuffle on resize.
const hash = (x: number, y: number, s: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Selectors are looked up inside the same host. focus: what the field gathers around (else the point fx, fy as
 * fractions of the host). avoid: things events never happen behind. calm: the copy; the field is masked down to
 * almost nothing over it and just past it, wherever it sits at this width (beside the devices or above them).
 */
export function NetworkField({
  quiet = false,
  focus,
  avoid,
  calm,
  fx = 0.72,
  fy = 0.45,
  runFor,
}: {
  quiet?: boolean;
  focus?: string;
  avoid?: string;
  calm?: string;
  fx?: number;
  fy?: number;
  /** Seconds of motion before the field settles on its last frame for good. Background motion next to
   *  reading content must stop within 5 s or offer a pause (WCAG 2.2.2), so pages of text pass 5. */
  runFor?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const layer = document.createElement("canvas");
    const lctx = layer.getContext("2d");
    if (!canvas || !ctx || !lctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const k = quiet ? 0.7 : 1;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let small = false;
    let pitch = 24;
    let n = 0;
    // Per dot: position, base alpha, base radius, closeness to the focus (0..1), lit colour and how lit (1 to 0).
    let xs = new Float32Array(0);
    let ys = new Float32Array(0);
    let rs = new Float32Array(0);
    let ws = new Float32Array(0);
    let heat = new Float32Array(0);
    let kind = new Uint8Array(0); // 0 none, 1 warned (amber), 2 paid (green), 3 stop (red)
    let seen = new Uint8Array(0); // the last ring that already warned this dot
    let spots = new Int32Array(0); // the indexes of the open dots, where events can start
    let nspots = 0;
    let open = new Uint8Array(0); // 1 when the dot is visible (not under the devices or the copy), so events there can be seen
    // Rings: centre, age in seconds, reach in px, id.
    const rx = new Float32Array(RINGS);
    const ry = new Float32Array(RINGS);
    const rage = new Float32Array(RINGS).fill(-1);
    const rmax = new Float32Array(RINGS);
    const rid = new Uint8Array(RINGS);
    let ringId = 0;

    let t = 0;
    let nextPaid = 0;
    let nextStop = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    let lit = 0; // dots and rings currently showing; when it's 0 twice in a row the frame isn't redrawn

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    let bgUrl = "";
    let alive = true;
    // The box drawn into last frame (cleared next frame) and the one being drawn now.
    let px0 = 0;
    let py0 = 0;
    let px1 = 0;
    let py1 = 0;
    let bx0 = 0;
    let by0 = 0;
    let bx1 = 0;
    let by1 = 0;
    const grow = (x: number, y: number, r: number) => {
      if (x - r < bx0) bx0 = x - r;
      if (y - r < by0) by0 = y - r;
      if (x + r > bx1) bx1 = x + r;
      if (y + r > by1) by1 = y + r;
    };

    type Box = readonly [number, number, number, number];
    const rectsOf = (sel?: string): Box[] => {
      if (!sel || !canvas.parentElement) return [];
      const c = canvas.getBoundingClientRect();
      const out: Box[] = [];
      canvas.parentElement.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width) out.push([r.left - c.left, r.top - c.top, r.right - c.left, r.bottom - c.top]);
      });
      return out;
    };
    const focalPoint = () => {
      const r = rectsOf(focus)[0];
      if (r) return { x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2, reach: Math.max(r[2] - r[0], r[3] - r[1]) * 1.25 };
      return { x: w * fx, y: h * fy, reach: Math.max(w, h) * 0.6 };
    };
    // Where the copy ends, and the fade that keeps the field off it. The fade is baked into the drawing (a
    // destination-in gradient) instead of a CSS mask: a masked canvas that repaints every frame is slow to
    // composite on phones without a GPU path. Without a calm selector, a fixed fade suits a hero with copy top left.
    type Fade = { x0: number; y0: number; x1: number; y1: number; stops: [number, number][] };
    const calmZone = (): { masked: (x: number, y: number) => boolean; fade: Fade } => {
      // Every matched element counts: the fade starts past all of them.
      const all = rectsOf(calm);
      const r = all.length
        ? ([Math.min(...all.map((q) => q[0])), Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[2])), Math.max(...all.map((q) => q[3]))] as const)
        : null;
      if (!r) {
        return w >= 1080
          ? { masked: (x) => x < w * 0.5, fade: { x0: 0, y0: 0, x1: w, y1: 0, stops: [[0.48, 0.1], [0.82, 1]] } }
          : { masked: (_x, y) => y < h * 0.6, fade: { x0: 0, y0: 0, x1: 0, y1: h, stops: [[0.55, 0.06], [1, 0.7]] } };
      }
      if (r[2] < w * 0.62) {
        const e = r[2];
        return { masked: (x) => x < e + 100, fade: { x0: e, y0: 0, x1: e + 140, y1: 0, stops: [[0, 0.08], [1, 1]] } };
      }
      const e = r[3];
      return { masked: (_x, y) => y < e + 80, fade: { x0: 0, y0: e, x1: 0, y1: e + 110, stops: [[0, 0.08], [1, 1]] } };
    };
    const gradient = (c: CanvasRenderingContext2D, f: Fade) => {
      const g = c.createLinearGradient(f.x0, f.y0, f.x1, f.y1);
      for (const [at, a] of f.stops) g.addColorStop(at, `rgba(0, 0, 0, ${a})`);
      return g;
    };
    let fadeFill: CanvasGradient | null = null;

    const build = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      if (!w || !h) return;
      small = w < 720;
      // Phones get a slightly softer canvas: 1px dots still look crisp and there's far less to fill.
      dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
      pitch = small ? 26 : 24;
      canvas.width = layer.width = Math.round(w * dpr);
      canvas.height = layer.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const f = focalPoint();
      const cols = Math.ceil(w / pitch) + 1;
      const rows = Math.ceil(h / pitch) + 1;
      const ox = (w - (cols - 1) * pitch) / 2;
      const oy = (h - (rows - 1) * pitch) / 2;
      const cap = cols * rows;
      xs = new Float32Array(cap);
      ys = new Float32Array(cap);
      rs = new Float32Array(cap);
      ws = new Float32Array(cap);
      heat = new Float32Array(cap);
      kind = new Uint8Array(cap);
      seen = new Uint8Array(cap);
      open = new Uint8Array(cap);
      spots = new Int32Array(cap);
      nspots = 0;
      n = 0;
      const boxes = rectsOf(avoid ?? focus);
      const { masked, fade } = calmZone();
      fadeFill = gradient(ctx, fade);

      lctx.clearRect(0, 0, w, h);
      lctx.fillStyle = DOT;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = ox + i * pitch;
          const y = oy + j * pitch;
          const d = Math.hypot(x - f.x, y - f.y) / f.reach;
          const near = Math.max(0, 1 - d);
          const wgt = near * near * (3 - 2 * near); // smoothstep
          // Sparse everywhere, dense near the devices: the edge of the field breaks up instead of ending in a line.
          if (hash(i, j, 1) > 0.1 + 0.9 * wgt) continue;
          const a = (0.16 + 0.32 * wgt) * k;
          const rad = 0.8 + 0.4 * wgt;
          xs[n] = x;
          ys[n] = y;
          rs[n] = rad;
          ws[n] = wgt;
          // Events only where they can be seen: not under the devices, and past the mask that keeps the copy clear.
          const covered = boxes.some((b) => x > b[0] - 6 && x < b[2] + 6 && y > b[1] - 6 && y < b[3] + 6);
          open[n] = covered || masked(x, y) ? 0 : 1;
          if (open[n]) spots[nspots++] = n;
          n++;
          lctx.globalAlpha = a;
          lctx.beginPath();
          lctx.arc(x, y, rad, 0, Math.PI * 2);
          lctx.fill();
        }
      }
      lctx.globalAlpha = 1;
      lctx.globalCompositeOperation = "destination-in";
      lctx.fillStyle = gradient(lctx, fade);
      lctx.fillRect(0, 0, w, h);
      lctx.globalCompositeOperation = "source-over";
      rage.fill(-1);
      px0 = py0 = px1 = py1 = 0;
      layer.toBlob((blob) => {
        if (!blob || !alive) return;
        const old = bgUrl;
        bgUrl = URL.createObjectURL(blob);
        canvas.style.backgroundImage = `url(${bgUrl})`;
        if (old) URL.revokeObjectURL(old);
      });
    };

    // A family close enough to the devices to be seen, but not in the faint outskirts.
    const pick = (min: number) => {
      if (!nspots) return -1;
      let any = -1;
      for (let tries = 0; tries < 24; tries++) {
        const i = spots[(Math.random() * nspots) | 0]!;
        if (kind[i] !== 0) continue;
        if (ws[i]! >= min) return i;
        any = i;
      }
      return any;
    };

    const stop = (i: number, age = 0) => {
      kind[i] = 3;
      heat[i] = 1;
      const s = rage.indexOf(-1);
      if (s < 0) return;
      ringId = (ringId % 250) + 1;
      rx[s] = xs[i]!;
      ry[s] = ys[i]!;
      rage[s] = age;
      rmax[s] = (small ? 130 : 210) * rand(0.85, 1.15);
      rid[s] = ringId;
    };

    // The ring waits for the red pulse, then eases out to its reach.
    const DELAY = 0.5;
    const SPREAD = 3.2;
    const radiusAt = (age: number, max: number) => {
      const p = Math.min(1, Math.max(0, (age - DELAY) / SPREAD));
      return max * (1 - Math.pow(1 - p, 3));
    };

    const step = (dt: number) => {
      t += dt;
      if (t >= nextPaid) {
        const i = pick(small ? 0.05 : 0.25);
        if (i >= 0) {
          kind[i] = 2;
          heat[i] = 1;
        }
        nextPaid = t + (small ? rand(2.2, 4.2) : rand(1.1, 2.6));
      }
      if (t >= nextStop) {
        const i = pick(small ? 0.1 : 0.35);
        if (i >= 0) stop(i);
        nextStop = t + (small ? rand(9, 13) : rand(6.5, 10));
      }
      for (let s = 0; s < RINGS; s++) {
        if (rage[s]! < 0) continue;
        rage[s]! += dt;
        const age = rage[s]!;
        if (age > DELAY + SPREAD) {
          rage[s] = -1;
          continue;
        }
        if (age < DELAY) continue;
        const r = radiusAt(age, rmax[s]!);
        const band = pitch * 0.6;
        const id = rid[s]!;
        for (let i = 0; i < n; i++) {
          if (seen[i] === id || kind[i] === 3 || kind[i] === 2 || open[i] === 0) continue;
          const d = Math.hypot(xs[i]! - rx[s]!, ys[i]! - ry[s]!);
          if (Math.abs(d - r) > band) continue;
          seen[i] = id;
          // Not everyone has paid this payee or will: only some families get the warning.
          if (hash(i, id, 7) < 0.42) {
            kind[i] = 1;
            heat[i] = 1;
          }
        }
      }
      lit = 0;
      for (let s = 0; s < RINGS; s++) if (rage[s]! >= 0) lit++;
      for (let i = 0; i < n; i++) {
        if (kind[i] === 0) continue;
        lit++;
        const life = kind[i] === 3 ? 3.4 : kind[i] === 1 ? 2.2 : 1.6;
        heat[i]! -= dt / life;
        if (heat[i]! <= 0) {
          heat[i] = 0;
          kind[i] = 0;
        }
      }
    };

    const drawLit = (which: number, color: string) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      for (let i = 0; i < n; i++) {
        if (kind[i] !== which) continue;
        const v = heat[i]!;
        // Fade in fast, out slowly: alpha follows the remaining heat, but the first tenth ramps up.
        const a = Math.min(1, (1 - v) * 10) * Math.pow(v, 0.6) * k;
        ctx.globalAlpha = a * (which === 1 ? 0.75 : 0.95);
        ctx.beginPath();
        ctx.arc(xs[i]!, ys[i]!, rs[i]! + (which === 3 ? 1.4 : 0.8), 0, Math.PI * 2);
        ctx.fill();
        grow(xs[i]!, ys[i]!, which === 1 ? 4 : 28);
        if (which !== 1) {
          // A small hairline ping around paid and stopped dots.
          const p = 1 - v;
          ctx.globalAlpha = Math.max(0, 0.5 - p * 1.4) * k;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(xs[i]!, ys[i]!, 3 + p * (which === 3 ? 22 : 14), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    const draw = () => {
      ctx.globalAlpha = 1;
      if (px1 > px0) ctx.clearRect(px0 - 2, py0 - 2, px1 - px0 + 4, py1 - py0 + 4);
      bx0 = by0 = Infinity;
      bx1 = by1 = -Infinity;
      // The warning travelling out from a stop.
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1;
      for (let s = 0; s < RINGS; s++) {
        const age = rage[s]!;
        if (age < DELAY) continue;
        const p = (age - DELAY) / SPREAD;
        ctx.globalAlpha = 0.24 * Math.pow(1 - p, 1.6) * k;
        const r = radiusAt(age, rmax[s]!);
        ctx.beginPath();
        ctx.arc(rx[s]!, ry[s]!, r, 0, Math.PI * 2);
        ctx.stroke();
        grow(rx[s]!, ry[s]!, r + 2);
      }
      drawLit(1, AMBER);
      drawLit(2, GREEN);
      drawLit(3, RED);
      ctx.globalAlpha = 1;
      if (bx1 > bx0) {
        // Fade what was just drawn the same way as the lattice, inside the drawn box only.
        if (fadeFill) {
          ctx.globalCompositeOperation = "destination-in";
          ctx.fillStyle = fadeFill;
          ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
          ctx.globalCompositeOperation = "source-over";
        }
        px0 = bx0;
        py0 = by0;
        px1 = bx1;
        py1 = by1;
      } else {
        px0 = py0 = px1 = py1 = 0;
      }
    };

    // Reduced motion: one still moment that tells the whole story. A stop, its ring part way out, the warned
    // families on it, and a couple of payments that went through.
    const still = () => {
      const i = pick(small ? 0.1 : 0.4);
      if (i >= 0) {
        stop(i, DELAY + SPREAD * 0.42);
        heat[i] = 0.6;
        const r = radiusAt(rage[0]!, rmax[0]!);
        for (let j = 0; j < n; j++) {
          const d = Math.hypot(xs[j]! - xs[i]!, ys[j]! - ys[i]!);
          if (j !== i && Math.abs(d - r) < pitch * 0.6 && hash(j, 3, 7) < 0.42) {
            kind[j] = 1;
            heat[j] = 0.7;
          }
        }
      }
      for (let g = 0; g < 3; g++) {
        const j = pick(0.3);
        if (j >= 0) {
          kind[j] = 2;
          heat[j] = 0.75;
        }
      }
      draw();
    };

    let ran = 0;
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      const before = lit;
      step(dt);
      if (lit || before) draw();
      ran += dt;
      if (runFor !== undefined && ran >= runFor) return; // settled: the last frame stays
      if (visible) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reduced || raf || !visible || !n || (runFor !== undefined && ran >= runFor)) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const halt = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const reset = () => {
      build();
      if (!n) return;
      t = 0;
      nextPaid = 0.4;
      nextStop = 1.2; // the first stop comes early, so a visitor sees the story without waiting
      if (reduced) still();
      else draw();
    };

    reset();
    let lastW = w;
    let lastH = h;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      lastW = r.width;
      lastH = r.height;
      reset();
      start();
    });
    ro.observe(canvas);
    let inView = true;
    const sync = () => {
      visible = inView && document.visibilityState === "visible";
      if (visible) start();
      else halt();
    };
    const io = new IntersectionObserver(([e]) => {
      inView = Boolean(e?.isIntersecting);
      sync();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    start();
    return () => {
      alive = false;
      halt();
      ro.disconnect();
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [quiet, focus, avoid, calm, fx, fy, runFor]);

  return <canvas ref={ref} className={quiet ? "netfield netfield-quiet" : "netfield"} aria-hidden="true" />;
}
