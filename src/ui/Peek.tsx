"use client";
// "Look at it safely": the page from the case file, live, opened on a separate computer in the cloud (KERNEL).
// The browser here only ever gets pictures of that computer's screen from our own server (/api/payments/[id]/peek),
// never a KERNEL link, and the only things it can do there are scroll up and scroll down. Built on the native
// <dialog>, which keeps focus inside, closes on Escape and gives focus back to the button.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, X } from "lucide-react";

type State = { kind: "idle" } | { kind: "opening" } | { kind: "live" } | { kind: "ended"; text: string } | { kind: "error"; text: string };

const FRAME_GAP_MS = 700;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Peek({ paymentId, host }: { paymentId: string; host: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [left, setLeft] = useState(0);
  const [frame, setFrame] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  // Bumped on every open and close, so a loop or timer from an earlier look stops by itself.
  const run = useRef(0);
  const base = `/api/payments/${encodeURIComponent(paymentId)}/peek`;

  const stop = useCallback(
    (how: "fetch" | "beacon" = "fetch") => {
      run.current++;
      // keepalive / sendBeacon so the cloud browser is deleted even when the page is going away.
      if (how === "beacon" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(`${base}/close`)) return;
      void fetch(`${base}/close`, { method: "POST", keepalive: true }).catch(() => undefined);
    },
    [base],
  );

  // Closing always tells the server (closing twice is fine there), whatever state the panel thinks it is in.
  const close = useCallback(() => {
    stop();
    setState({ kind: "idle" });
    setFrame(null);
    if (dialog.current?.open) dialog.current.close();
    trigger.current?.focus();
  }, [stop]);

  // Pictures: one at a time, the next asked for a moment after the last arrived.
  const loop = useCallback(
    async (me: number) => {
      let misses = 0;
      while (run.current === me) {
        let res: Response;
        try {
          res = await fetch(`${base}/frame`, { cache: "no-store" });
        } catch {
          res = new Response(null, { status: 599 });
        }
        if (run.current !== me) return;
        if (res.status === 410) {
          run.current++;
          setState({ kind: "ended", text: "This look has ended and the cloud computer was switched off." });
          return;
        }
        if (res.ok) {
          try {
            const url = URL.createObjectURL(await res.blob());
            if (run.current !== me) return URL.revokeObjectURL(url);
            setFrame(url); // the effect below frees the previous picture
            misses = 0;
          } catch {
            misses++;
          }
        } else if (res.status !== 429) misses++;
        if (misses >= 4) {
          stop();
          setState({ kind: "error", text: "The pictures stopped coming through, so the look was closed." });
          return;
        }
        await new Promise((r) => setTimeout(r, FRAME_GAP_MS));
      }
    },
    [base, stop],
  );

  const start = async () => {
    const me = ++run.current;
    setState({ kind: "opening" });
    setFrame(null);
    setSaid("");
    dialog.current?.showModal();
    const view = window.matchMedia("(max-width: 640px)").matches ? "phone" : "desktop";
    let res: Response;
    try {
      res = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ view }) });
    } catch {
      // The request may have reached the server even though the answer didn't: close whatever it opened.
      if (run.current === me) {
        stop();
        setState({ kind: "error", text: "Spotter couldn't be reached. Check your connection and try again." });
      }
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { secondsLeft?: number; error?: string };
    if (run.current !== me) {
      // Closed while it was opening: make sure that browser goes too.
      if (res.ok) stop();
      return;
    }
    if (!res.ok || typeof data.secondsLeft !== "number") {
      if (res.status !== 409) stop(); // 409: a look is already open, leave that one be
      setState({ kind: "error", text: data.error ?? "The page couldn't be opened safely. Try again in a minute." });
      return;
    }
    setLeft(data.secondsLeft);
    setState({ kind: "live" });
    void loop(me);
  };

  // The countdown. At zero the look closes; the server ends it at the same time anyway.
  useEffect(() => {
    if (state.kind !== "live") return;
    const me = run.current;
    const t = setInterval(() => {
      if (run.current === me) setLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "live") return;
    if (left === 30 || left === 10) setSaid(`${left} seconds left.`);
    if (left === 0) {
      stop();
      setState({ kind: "ended", text: "Time's up. The cloud computer was switched off." });
    }
  }, [left, state.kind, stop]);

  // Leaving the page or hiding the tab ends the look, so no cloud browser is left running.
  useEffect(() => {
    if (state.kind !== "live" && state.kind !== "opening") return;
    const gone = () => {
      stop("beacon");
      setState({ kind: "ended", text: "The look was closed when you left the page." });
    };
    const hidden = () => document.visibilityState === "hidden" && gone();
    window.addEventListener("pagehide", gone);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", gone);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [state.kind, stop]);

  // Unmounting while open (the card goes away after a decision) closes it too.
  const live = state.kind === "live" || state.kind === "opening";
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  useEffect(() => () => void (liveRef.current && stop()), [stop]);

  useEffect(() => () => void (frame && URL.revokeObjectURL(frame)), [frame]);

  const scroll = async (direction: "up" | "down") => {
    const res = await fetch(`${base}/scroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction }) }).catch(() => null);
    if (res?.status === 410) {
      run.current++;
      setState({ kind: "ended", text: "This look has ended and the cloud computer was switched off." });
    }
  };

  return (
    <>
      <button ref={trigger} type="button" className="case-watch" onClick={start} aria-haspopup="dialog">
        <Eye size={15} strokeWidth={2.2} aria-hidden="true" /> Look at it safely
      </button>
      <dialog
        ref={dialog}
        className="peek"
        aria-labelledby={`peek-title-${paymentId}`}
        aria-describedby={`peek-about-${paymentId}`}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        // A dialog can also close without a cancel event (a second Escape in some browsers): end the look too.
        onClose={() => {
          if (state.kind !== "idle") close();
        }}
      >
        <div className="peek-box">
          <div className="peek-head">
            <div>
              <h2 id={`peek-title-${paymentId}`} className="peek-title">
                {host}
              </h2>
              <p id={`peek-about-${paymentId}`} className="peek-about">
                Cloud browser (KERNEL): open on a separate computer in the cloud. Only a picture of its screen reaches yours.
              </p>
            </div>
            <button type="button" className="btn btn-primary peek-close" onClick={close} autoFocus>
              <X size={18} strokeWidth={2.4} aria-hidden="true" /> Close
            </button>
          </div>

          <p className="peek-warn">
            <b>Don&apos;t type passwords or card details here.</b> You can look and scroll. Clicks and typing never reach the page.
          </p>

          <div className="peek-screen" data-state={state.kind}>
            {frame && state.kind === "live" ? (
              <img src={frame} alt={`Live picture of ${host}, updated about once a second`} />
            ) : state.kind === "opening" || (state.kind === "live" && !frame) ? (
              <p className="peek-status" role="status">
                <span className="case-spin" aria-hidden="true" /> Opening the page on a computer in the cloud
              </p>
            ) : state.kind === "ended" || state.kind === "error" ? (
              <p className="peek-status" role="status">
                {state.text}
              </p>
            ) : null}
          </div>

          <div className="peek-foot">
            {state.kind === "live" ? (
              <>
                <div className="peek-scroll">
                  <button type="button" className="btn btn-quiet" onClick={() => scroll("up")}>
                    <ChevronUp size={18} aria-hidden="true" /> Scroll up
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => scroll("down")}>
                    <ChevronDown size={18} aria-hidden="true" /> Scroll down
                  </button>
                </div>
                <p className="peek-left">
                  Closes in <b>{clock(left)}</b>
                </p>
              </>
            ) : state.kind === "ended" || state.kind === "error" ? (
              <button type="button" className="btn btn-quiet" onClick={start}>
                Look again
              </button>
            ) : null}
            <p className="sr-only" aria-live="polite">
              {said}
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
