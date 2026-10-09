"use client";
// The hero scene. Replays its story every few seconds while on screen, like a product demo, and leans
// slightly towards the pointer. Reduced motion: shown once, still.
import { useEffect, useRef, useState } from "react";

const LOOP_MS = 11_000;

export function HeroStage({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = Boolean(e?.isIntersecting);
    });
    io.observe(el);
    const t = setInterval(() => {
      if (visible && document.visibilityState === "visible") setRound((r) => r + 1);
    }, LOOP_MS);

    // Pointer tilt: a few degrees at most, eased by a CSS transition so it never snaps.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) / r.width;
      const y = (e.clientY - (r.top + r.height / 2)) / r.height;
      el.style.setProperty("--rx", `${(-y * 5).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`);
    };
    const leave = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    if (fine) {
      window.addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerleave", leave);
    }
    return () => {
      io.disconnect();
      clearInterval(t);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={ref} className="stage-dark" aria-label={label}>
      <div className="stage-tilt" key={round}>
        {children}
      </div>
    </div>
  );
}
