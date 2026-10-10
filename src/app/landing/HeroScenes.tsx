"use client";
// The hero: one phone and one laptop, cycling through five short scenes, one per way money gets asked for.
// The active tab's progress bar is the clock: when its CSS animation ends, the next scene starts. Pausing (hover,
// focus, the pause button, off screen, hidden tab) pauses that bar and every animation in the scene together.
// Reduced motion: nothing plays by itself, each scene shows its finished state, and the tabs still work.
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Iphone } from "./Devices";
import { AgentScreen, CaseScreen, HeldScreen, Laptop, ProtectScreen, WatchtowerScreen } from "./Laptop";
import { CoinsPhone, DiscordPhone, EmailPhone, ShopPhone, TextPhone } from "./HeroPhones";

const SCENE_MS = 5600;

const SCENES = [
  {
    key: "text",
    tab: "Text",
    caption: "Gran forwards a \"Hi Mum\" text to Spotter on Telegram. PayPal holds the £250, and you say no from your laptop.",
    Phone: TextPhone,
    Screen: HeldScreen,
  },
  {
    key: "email",
    tab: "Email",
    caption: "A parcel fee email, forwarded. The case agent checks the link and what other Spotter families saw.",
    Phone: EmailPhone,
    Screen: CaseScreen,
  },
  {
    key: "discord",
    tab: "Discord",
    caption: "Leo right clicks a seller's message: Apps, Check with Spotter. Friends and Family gets refused, and Spotter finds a safer shop.",
    Phone: DiscordPhone,
    Screen: ProtectScreen,
    dark: true,
  },
  {
    key: "agent",
    tab: "AI agent",
    short: "Agent",
    caption: "Your shopping agent reads a shop page with hidden instructions. Spotter stops the payment, and the agent has no approve tool.",
    Phone: ShopPhone,
    Screen: AgentScreen,
  },
  {
    key: "gift",
    tab: "Gift card",
    short: "Gift",
    caption: "A free coins site wants Leo's gift card code. Stopped, and you can ask Watchtower what Leo tried to spend.",
    Phone: CoinsPhone,
    Screen: WatchtowerScreen,
  },
] as const;

export function HeroScenes() {
  const ref = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [i, setI] = useState(0);
  const [run, setRun] = useState(0);
  const [held, setHeld] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [away, setAway] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener("change", onMq);

    let inView = true;
    const sync = () => setAway(!inView || document.visibilityState !== "visible");
    const io = new IntersectionObserver(([e]) => {
      inView = Boolean(e?.isIntersecting);
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);

    // Pointer tilt: a few degrees at most, eased by a CSS transition so it never snaps.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !mq.matches;
    const stage = el.querySelector<HTMLElement>(".hs-tilt");
    const move = (e: PointerEvent) => {
      if (!stage) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) / r.width;
      const y = (e.clientY - (r.top + r.height / 2)) / r.height;
      stage.style.transform = `rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
    };
    const leave = () => {
      if (stage) stage.style.transform = "";
    };
    if (fine) {
      window.addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerleave", leave);
    }
    return () => {
      mq.removeEventListener("change", onMq);
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  const go = (n: number) => {
    setI((n + SCENES.length) % SCENES.length);
    setRun((r) => r + 1);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
    e.preventDefault();
    const n = k === "Home" ? 0 : k === "End" ? SCENES.length - 1 : i + (k === "ArrowRight" ? 1 : -1);
    const next = (n + SCENES.length) % SCENES.length;
    go(next);
    tabs.current[next]?.focus();
  };

  const paused = held || hover || focus || away;
  const s = SCENES[i]!;

  return (
    <div
      ref={ref}
      className="hs"
      data-paused={paused || undefined}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      // Keyboard focus pauses; a mouse click on a tab shouldn't leave the scenes stuck once the pointer leaves.
      onFocus={(e) => setFocus((e.target as HTMLElement).matches(":focus-visible"))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <div className="hs-stage" id="hs-panel" role="tabpanel" aria-labelledby={`hs-tab-${s.key}`}>
        <p className="hs-sr">{s.caption}</p>
        <div className="hs-tilt" aria-hidden="true">
          <div className="hs-duo">
            <div className="hs-duo-inner" key={`${s.key}-${run}`} data-scene={s.key}>
              <Laptop>
                <s.Screen />
              </Laptop>
              <div className="hs-phone">
                <Iphone scale={0.5} dark={"dark" in s} className="iphone-gran hs-iphone">
                  <s.Phone />
                </Iphone>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hs-controls">
        <div className="hs-tabs" role="tablist" aria-label="What Spotter checks" onKeyDown={onKey}>
          {SCENES.map((x, n) => (
            <button
              key={x.key}
              ref={(el) => {
                tabs.current[n] = el;
              }}
              id={`hs-tab-${x.key}`}
              role="tab"
              type="button"
              aria-selected={n === i}
              aria-controls="hs-panel"
              tabIndex={n === i ? 0 : -1}
              className="hs-tab"
              aria-label={x.tab}
              onClick={() => go(n)}
            >
              {"short" in x ? (
                <>
                  <span className="hs-long">{x.tab}</span>
                  <span className="hs-short">{x.short}</span>
                </>
              ) : (
                x.tab
              )}
              <span className="hs-bar" aria-hidden="true">
                {n === i && !reduced && (
                  <i key={run} style={{ animationDuration: `${SCENE_MS}ms` }} onAnimationEnd={() => go(i + 1)} />
                )}
              </span>
            </button>
          ))}
        </div>
        {!reduced && (
          <button type="button" className="hs-pause" onClick={() => setHeld((h) => !h)} aria-label={held ? "Play the scenes" : "Pause the scenes"}>
            {held ? <Play size={16} strokeWidth={2.2} aria-hidden="true" /> : <Pause size={16} strokeWidth={2.2} aria-hidden="true" />}
          </button>
        )}
      </div>
      <p className="hs-caption" aria-hidden="true">
        {s.caption}
      </p>
    </div>
  );
}
