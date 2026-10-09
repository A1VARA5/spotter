"use client";
// A sentence that lights up word by word as it scrolls through the screen.
import { useEffect, useRef } from "react";

export function LitText({ lead, rest }: { lead: string; rest: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = [...lead.split(" ").map((w) => ({ w, lead: true })), ...rest.split(" ").map((w) => ({ w, lead: false }))];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--p", "1");
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the sentence enters at 85% of the screen, 1 when it reaches 35%.
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.5 + r.height * 0.6)));
      el.style.setProperty("--p", p.toFixed(3));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <p ref={ref} className="lit" style={{ "--n": words.length } as React.CSSProperties}>
      {words.map((x, i) => (
        <span key={i} className={x.lead ? "lit-w lit-lead" : "lit-w"} style={{ "--i": i } as React.CSSProperties}>
          {x.w}{" "}
        </span>
      ))}
    </p>
  );
}
