"use client";
// Marks its children as shown the first time they scroll into view, so CSS can play one explanatory moment.
// Content is visible by default: without JavaScript, or with reduced motion, nothing is hidden.
import { useEffect, useRef, useState } from "react";

export function Reveal({ children, className, as: Tag = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "article" | "ol" }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "waiting" | "shown">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already on screen at load: show straight away rather than hiding and replaying.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;
    setState("waiting");
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref as never} className={className} data-reveal={state}>
      {children}
    </Tag>
  );
}
