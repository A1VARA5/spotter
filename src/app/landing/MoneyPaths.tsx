"use client";
// The soft background behind the dark heroes: faint money paths drift across, small payments travel along them,
// wait at Spotter's checkpoint with an amber pulse, then go on (green) or turn back (red). One canvas, drawn at
// the device pixel ratio, paused when off screen or the tab is hidden, a still frame for reduced motion, and
// fewer paths on small screens. Decorative only: hidden from assistive tech and masked away from body copy.
import { useEffect, useRef } from "react";

type Token = { lane: number; x: number; speed: number; state: "wait" | "travel" | "hold" | "go" | "back"; t: number; hold: number; ok: boolean };

const AMBER = "242, 183, 5";
const GREEN = "60, 170, 120";
const RED = "214, 76, 64";

export function MoneyPaths({ quiet = false, checkpoint = 0.46 }: { quiet?: boolean; checkpoint?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const k = quiet ? 0.6 : 1;

    let w = 0;
    let h = 0;
    let lanes = 0;
    let tokens: Token[] = [];
    let raf = 0;
    let last = 0;
    let phase = 0;
    let visible = true;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const cx = () => w * (w < 1080 ? 0.5 : checkpoint);
    const laneY = (i: number, x: number) => {
      const base = h * (0.1 + (0.82 * (i + 0.5)) / lanes);
      return base + Math.sin(x * 0.004 + i * 1.7 + phase) * (10 + (i % 3) * 5);
    };
    const fresh = (lane: number, delay: number): Token => ({ lane, x: -20, speed: rand(55, 95), state: "wait", t: delay, hold: rand(1.1, 2), ok: Math.random() < 0.68 });

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lanes = w < 640 ? 4 : w < 1080 ? 5 : 7;
      tokens = Array.from({ length: lanes }, (_, i) => fresh(i, rand(0, 6)));
      if (reduced) {
        // A still frame that still tells the story: one waiting, one through, one sent back.
        const c = cx();
        tokens.forEach((t, i) => {
          const pick = i % 3;
          t.state = pick === 0 ? "hold" : pick === 1 ? "go" : "back";
          t.x = pick === 0 ? c - 10 : pick === 1 ? c + (w - c) * 0.45 : c * 0.55;
          t.t = 0;
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const c = cx();
      // Paths
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(238, 242, 245, ${0.07 * k})`;
      for (let i = 0; i < lanes; i++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 16) {
          const y = laneY(i, x);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // The checkpoint
      ctx.strokeStyle = `rgba(${AMBER}, ${0.12 * k})`;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(c, 0);
      ctx.lineTo(c, h);
      ctx.stroke();
      ctx.setLineDash([]);
      // Payments
      for (const t of tokens) {
        if (t.state === "wait") continue;
        const y = laneY(t.lane, t.x);
        let rgb = "238, 242, 245";
        let a = 0.5 * k;
        if (t.state === "hold") {
          rgb = AMBER;
          const pulse = reduced ? 0.5 : (Math.sin(t.t * 5) + 1) / 2;
          ctx.strokeStyle = `rgba(${AMBER}, ${(0.12 + 0.22 * pulse) * k})`;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(t.x, y, 7 + pulse * 4, 0, Math.PI * 2);
          ctx.stroke();
          a = 0.7 * k;
        } else if (t.state === "go") {
          rgb = GREEN;
          a = 0.65 * k * Math.max(0, Math.min(1, (w - t.x) / 120));
        } else if (t.state === "back") {
          rgb = RED;
          a = 0.65 * k * Math.max(0, Math.min(1, t.x / (c * 0.6)));
        }
        ctx.fillStyle = `rgba(${rgb}, ${a})`;
        ctx.beginPath();
        ctx.roundRect(t.x - 7, y - 3, 14, 6, 3);
        ctx.fill();
      }
    };

    const step = (dt: number) => {
      phase += dt * 0.06;
      const c = cx();
      tokens = tokens.map((t) => {
        // In "wait", t counts down to the start; in every other state it counts up.
        t.t += t.state === "wait" ? -dt : dt;
        switch (t.state) {
          case "wait":
            if (t.t <= 0) return { ...fresh(t.lane, 0), state: "travel" };
            return t;
          case "travel":
            t.x += t.speed * dt * Math.max(0.25, Math.min(1, (c - 12 - t.x) / 120));
            if (t.x >= c - 13) {
              t.state = "hold";
              t.t = 0;
            }
            return t;
          case "hold":
            if (t.t >= t.hold) t.state = t.ok ? "go" : "back";
            return t;
          case "go":
            t.x += t.speed * dt;
            return t.x > w + 20 ? fresh(t.lane, rand(1, 5)) : t;
          case "back":
            t.x -= t.speed * 0.8 * dt;
            return t.x < -20 ? fresh(t.lane, rand(1, 5)) : t;
        }
      });
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      step(dt);
      draw();
      if (visible) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (reduced || raf || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    let inView = true;
    const sync = () => {
      visible = inView && document.visibilityState === "visible";
      if (visible) start();
      else stop();
    };
    const io = new IntersectionObserver(([e]) => {
      inView = Boolean(e?.isIntersecting);
      sync();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    start();
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [quiet, checkpoint]);

  return <canvas ref={ref} className={quiet ? "mpaths mpaths-quiet" : "mpaths"} aria-hidden="true" />;
}
