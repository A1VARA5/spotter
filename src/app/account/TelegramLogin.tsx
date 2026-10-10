"use client";
// Telegram's own login button. It only works on the domain set in BotFather (/setdomain), so on other hosts
// the start link is offered too.
import { useEffect, useRef } from "react";

export function TelegramLogin({ bot }: { bot: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "12");
    s.setAttribute("data-auth-url", "/api/auth/telegram");
    s.setAttribute("data-request-access", "write");
    el.appendChild(s);
    // Telegram's script adds an iframe with no title; screen readers then announce just "frame" (WCAG 4.1.2).
    const name = () => el.querySelector("iframe:not([title])")?.setAttribute("title", "Log in with Telegram");
    const mo = new MutationObserver(name);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      el.innerHTML = "";
    };
  }, [bot]);
  return <div ref={box} className="tg-login" />;
}
