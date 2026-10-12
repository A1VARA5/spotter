"use client";
// A toolbar menu closes on Escape or a click anywhere outside it, and Escape gives focus back to its button.
// Clicks inside a confirm dialog opened from the menu count as inside (the dialog is rendered inside the wrapper).
import { useEffect, type RefObject } from "react";

export function useDismiss(open: boolean, close: () => void, wrap: RefObject<HTMLElement | null>, buttonSelector: string) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // An open confirm dialog takes Escape itself: the menu stays put behind it.
      if (wrap.current?.querySelector("dialog[open]")) return;
      close();
      wrap.current?.querySelector<HTMLButtonElement>(buttonSelector)?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, wrap, buttonSelector]);
}
