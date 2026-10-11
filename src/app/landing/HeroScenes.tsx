"use client";
// The hero: three short scenes, Gran first, and under them the channels each one works in. "Was it you?" (Gran's phone and Tom's), then an AI agent steered by a
// shop's tool, then Watchtower with the AI's receipt. The people, shops and numbers are examples; the wording on the
// screens is the product's own (copy.ts).
// The active tab's progress bar is the clock: when its CSS animation ends, the next scene starts. Pausing (hover,
// focus, the pause button, off screen, hidden tab) pauses that bar.
// Reduced motion: nothing plays by itself, each scene shows its finished state, and the tabs still work.
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Iphone } from "./Devices";
import { AgentScreen, Laptop, WatchtowerScreen } from "./Laptop";
import { GranAskPhone, GranViewPhone, SamAlertPhone, TomPhone } from "./HeroPhones";

type Scene = {
  key: string;
  tab: string;
  short?: string;
  caption: string;
  ms: number;
  /** The device at the back: a laptop screen, or a second phone. */
  Back: () => React.ReactNode;
  backKind: "laptop" | "phone";
  Phone: () => React.ReactNode;
  /** Who each device belongs to, said under the stage. */
  who: string;
};

const SCENES: Scene[] = [
  {
    key: "wiy",
    tab: "Was it you?",
    short: "Was it you",
    caption: "A text says it's Tom and asks Gran for £250. PayPal holds it, Spotter asks the real Tom, and his Not me releases it.",
    ms: 7600,
    Back: TomPhone,
    backKind: "phone",
    Phone: GranAskPhone,
    who: "Gran's phone and Tom's phone",
  },
  {
    key: "agent",
    tab: "AI agent",
    short: "Agent",
    caption: "A shop hides an order for AI agents in one of its tools. The agent falls for it, Spotter holds the payment and shows Sam the line.",
    ms: 6800,
    Back: AgentScreen,
    backKind: "laptop",
    Phone: SamAlertPhone,
    who: "The agent's screen and Sam's phone",
  },
  {
    key: "tower",
    tab: "Watchtower",
    short: "Watch",
    caption: "Sam asks about the month and the board answers. The receipt comes from AG Studio's own record: Money actions: 0. Gran sees it in big type.",
    ms: 6800,
    Back: WatchtowerScreen,
    backKind: "laptop",
    Phone: GranViewPhone,
    who: "Sam's laptop and Gran's phone",
  },
];

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
        <p className="hs-sr">
          Example, {s.who}. {s.caption}
        </p>
        <div className="hs-tilt" aria-hidden="true">
          <div className="hs-duo">
            <div className="hs-duo-inner" key={`${s.key}-${run}`} data-scene={s.key}>
              {s.backKind === "laptop" ? (
                <Laptop>
                  <s.Back />
                </Laptop>
              ) : (
                <div className="hs-back-phone">
                  <Iphone scale={0.56} className="hs-iphone">
                    <s.Back />
                  </Iphone>
                </div>
              )}
              <div className="hs-phone">
                <Iphone scale={s.backKind === "phone" ? 0.56 : 0.5} className="iphone-gran hs-iphone">
                  <s.Phone />
                </Iphone>
              </div>
              {s.key === "wiy" && (
                <span className="hs-tag hs-tag-hold">
                  <span className="hs-tag-a">£250 on hold at PayPal</span>
                  <span className="hs-tag-b">Released, nothing paid</span>
                </span>
              )}
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
              onClick={() => go(n)}
            >
              {x.tab}
              <span className="hs-bar" aria-hidden="true">
                {n === i && !reduced && (
                  <i key={run} style={{ animationDuration: `${x.ms}ms` }} onAnimationEnd={() => go(i + 1)} />
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
        <span className="hs-who">Example: {s.who}. Spotter&apos;s real screens, made up people.</span>
      </p>
      {/* Was "Nobody installs anything new", a section of its own with a tab per channel (folded in 2026-10-11). */}
      <p className="hs-chan">
        <b>Nobody installs anything new.</b> Gran forwards from her email or Telegram, Leo right clicks a message in Discord, and your AI agent
        calls Spotter&apos;s tool. <a href="/how#channels">How each person connects</a>
      </p>
    </div>
  );
}
