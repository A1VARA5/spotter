"use client";
// Looping animations pause while their section is off screen (and while the tab is hidden), so the page
// costs nothing when nobody is looking. Sections opt in with data-loop.
import { useEffect } from "react";

export function LoopPauser() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-loop]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.target as HTMLElement).dataset.inview = e.isIntersecting ? "true" : "false";
      },
      { rootMargin: "100px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
