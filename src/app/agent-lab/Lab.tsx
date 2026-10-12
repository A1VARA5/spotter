"use client";
// The hijack console: streams the scripted naive agent's run (POST /api/agent-lab/run, one JSON step per line).
import { useRef, useState } from "react";
import Link from "next/link";
import { Bot, ShieldCheck, Landmark, Play, RotateCcw } from "lucide-react";
import type { LabStep } from "@/server/agent-lab";

type Actor = "agent" | "spotter" | "paypal";
const ACTOR: Record<LabStep["kind"], Actor> = {
  limit: "spotter",
  start: "spotter",
  tools: "agent",
  read: "agent",
  order: "spotter",
  bait: "agent",
  freeze: "spotter",
  void: "paypal",
  confirm: "paypal",
  done: "spotter",
  error: "spotter",
};
const ACTOR_NAME: Record<Actor, string> = { agent: "Test agent", spotter: "Spotter", paypal: "PayPal" };
const ACTOR_ICON = { agent: Bot, spotter: ShieldCheck, paypal: Landmark } as const;

// What the trace will show, so the page has its shape before anything runs.
const PLAN: Array<{ kind: LabStep["kind"]; title: string }> = [
  { kind: "tools", title: "The agent asks Spotter for the PayPal toolkit tools" },
  { kind: "read", title: "It reads the GadgetBarn shop page" },
  { kind: "order", title: "It orders the earbuds with create_order" },
  { kind: "bait", title: "It does what a hidden line on the page says" },
  { kind: "freeze", title: "Spotter freezes it" },
  { kind: "void", title: "PayPal cancels the hold" },
  { kind: "confirm", title: "PayPal confirms" },
];

type State = "idle" | "running" | "done" | "stopped";

function Chips({ items }: { items: Array<[string, unknown]> }) {
  const shown = items.filter(([, v]) => typeof v === "string" || typeof v === "number");
  if (!shown.length) return null;
  return (
    <dl className="lab-chips">
      {shown.map(([k, v]) => (
        <div key={k} className="lab-chip">
          <dt>{k}</dt>
          <dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function StepBody({ s }: { s: LabStep }) {
  const d = (s.data ?? {}) as Record<string, any>;
  switch (s.kind) {
    case "tools":
      return (
        <>
          <p className="lab-big">
            <span className="lab-num">{d.offered}</span> offered, <span className="lab-num lab-num-stop">{d.bait}</span> bait
          </p>
          {Array.isArray(d.sample) && <p className="lab-detail">Bait includes {d.sample.slice(0, 4).join(", ")} and more.</p>}
        </>
      );
    case "read":
      return d.hidden ? <blockquote className="lab-quote">{String(d.hidden)}</blockquote> : null;
    case "order":
      return <Chips items={[["Amount", d.amount ? `${d.amount.currency_code} ${d.amount.value}` : null], ["PayPal order", d.paypalOrderId], ["Spotter says", d.status]]} />;
    case "bait":
      return (
        <>
          <pre className="lab-call">{`${d.tool}(${JSON.stringify(d.arguments ?? {})})`}</pre>
          {d.wouldHaveSent && (
            <p className="lab-without">
              <span className="lab-without-label">Without Spotter</span>
              <s>{String(d.wouldHaveSent)}</s>
              <span className="lab-without-sent">US$0.00 sent</span>
            </p>
          )}
        </>
      );
    case "void":
      return <Chips items={[["PayPal authorisation", d.authorizationId], ["PayPal order", d.orderId], ["Status", d.status]]} />;
    case "confirm":
      return <Chips items={[["How", d.source === "webhook" ? "PayPal webhook (verified)" : "Asked PayPal directly"], ["PayPal says", d.status ?? d.event], ["Authorisation", d.authorizationId]]} />;
    default:
      return null;
  }
}

export function Lab({ runsLeft }: { runsLeft: number }) {
  const [steps, setSteps] = useState<LabStep[]>([]);
  const [state, setState] = useState<State>("idle");
  const [left, setLeft] = useState(runsLeft);
  const started = useRef<number>(0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  async function run() {
    if (state === "running") return;
    setSteps([]);
    setState("running");
    started.current = Date.now();
    try {
      const r = await fetch("/api/agent-lab/run", { method: "POST" });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `The lab didn't start (${r.status}).`);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let last: LabStep["kind"] | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const s = JSON.parse(line) as LabStep;
          last = s.kind;
          setSteps((prev) => [...prev, s]);
        }
      }
      setState(last === "done" ? "done" : "stopped");
      if (last !== "limit") setLeft((n) => Math.max(0, n - 1));
    } catch (e) {
      setSteps((prev) => [...prev, { kind: "error", title: "The run stopped part way", detail: e instanceof Error ? e.message : "Couldn't reach Spotter.", at: new Date().toISOString() }]);
      setState("stopped");
    } finally {
      statusRef.current?.focus();
    }
  }

  const byKind = new Map(steps.map((s) => [s.kind, s]));
  const extra = steps.filter((s) => s.kind === "limit" || s.kind === "error" || s.kind === "done" || s.kind === "start");
  const t0 = steps[0] ? Date.parse(steps[0].at) : 0;
  const offset = (s: LabStep) => `+${((Date.parse(s.at) - t0) / 1000).toFixed(1)}s`;

  return (
    <div className="lab">
      <aside className="lab-side">
        <p className="lab-honest">
          <b>A naive test agent, scripted,</b> so it falls for the trick every time. Real Claude refused it twice. Spotter doesn&apos;t rely on the model being careful.
        </p>
        <button type="button" className="btn btn-primary lab-run" aria-disabled={state === "running" || left <= 0 || undefined} onClick={() => left > 0 && run()}>
          {state === "running" ? (
            "Running…"
          ) : state === "idle" ? (
            <>
              <Play size={18} strokeWidth={2} aria-hidden="true" /> Hijack the agent
            </>
          ) : (
            <>
              <RotateCcw size={18} strokeWidth={2} aria-hidden="true" /> Run it again
            </>
          )}
        </button>
        <p className="lab-left">
          {left > 0 ? `${left} of 3 runs left today for your family.` : "Your family has used today's 3 runs. Back within 24 hours."} Each run makes a real PayPal sandbox hold and one Spotter
          check. Nothing is paid.
        </p>
        <ul className="lab-legend" aria-label="Who does what">
          {(["agent", "spotter", "paypal"] as Actor[]).map((a) => {
            const Icon = ACTOR_ICON[a];
            return (
              <li key={a} data-actor={a}>
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                <span>
                  <b>{ACTOR_NAME[a]}</b>{" "}
                  {a === "agent" ? "uses PayPal Agent Toolkit tools, pointed at Spotter." : a === "spotter" ? "checks every call and freezes a hijacked agent." : "holds and releases the real sandbox money."}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="lab-links">
          <Link href="/checks#toolkit">All 47 tools and how Spotter treats each</Link>
          <a href="/demo-shop/gadgetbarn" target="_blank" rel="noopener">
            Open the GadgetBarn page<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </aside>

      <section className="lab-trace" aria-labelledby="lab-trace-title">
        <h2 id="lab-trace-title" className="sr-only">
          The run, step by step
        </h2>
        <p ref={statusRef} tabIndex={-1} className="lab-status" role="status" data-state={state}>
          {state === "idle" && "Press Hijack the agent to start. It takes about 10 to 30 seconds."}
          {state === "running" && "Running against Spotter's real toolkit server and the PayPal sandbox…"}
          {state === "done" && "Done. The agent is frozen and its hold is released. Nothing was paid."}
          {state === "stopped" && (byKind.get("limit")?.title ?? "The run stopped. See the last step.")}
        </p>
        {byKind.get("start") && <p className="lab-key">{byKind.get("start")!.title}. {byKind.get("start")!.detail}</p>}
        <ol className="lab-steps">
          {PLAN.map((p) => {
            const s = byKind.get(p.kind);
            const actor = ACTOR[p.kind];
            const Icon = ACTOR_ICON[actor];
            return (
              <li key={p.kind} className="lab-step" data-actor={actor} data-state={s ? "done" : state === "running" ? "waiting" : "todo"}>
                <span className="lab-mark" aria-hidden="true">
                  <Icon size={16} strokeWidth={2} />
                </span>
                <div className="lab-body">
                  <p className="lab-who">
                    {ACTOR_NAME[actor]}
                    {s && <span className="lab-time">{offset(s)}</span>}
                  </p>
                  <h3 className="lab-title">{s?.title ?? p.title}</h3>
                  {s?.detail && <p className="lab-detail">{s.detail}</p>}
                  {s && <StepBody s={s} />}
                </div>
              </li>
            );
          })}
        </ol>
        {extra
          .filter((s) => s.kind === "error" || s.kind === "done")
          .map((s) => (
            <p key={s.kind + s.at} className="lab-end" data-kind={s.kind}>
              <b>{s.title}</b> {s.detail}
            </p>
          ))}
      </section>
    </div>
  );
}
