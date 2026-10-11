"use client";
// What Spotter checks that you can't, shown inside the walkthrough's "Checked" stop: the outside checks, each as the
// real piece of Spotter it produces, drawn in Spotter's own style with example data. Three come from the throwaway
// cloud browser (KERNEL), two from real shop listings (Channel3). Wording mirrors src/ui/Peek.tsx, src/ui/CaseFile.tsx
// (tools, two faces, where the money goes), src/ui/PriceWatch.tsx, src/agents/twofaces.ts, src/agents/trail.ts and
// src/market/lookalike.ts.
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { AGENT, FACES } from "./copy";

const KERNEL = "Runs in a KERNEL cloud browser that is thrown away after each visit, so nothing on the page reaches Gran's phone or your laptop.";
const CHANNEL3 = "Real shop prices from Channel3, live. Spotter never buys anything.";

const VIEWS: ReadonlyArray<{ key: "peek" | "tools" | "faces" | "spot" | "watch"; tab: string; head: string; credit: string }> = [
  { key: "faces", tab: "Two faces", head: "Some scam pages show scanners a harmless page and Gran's phone a card form. Spotter opens it both ways.", credit: KERNEL },
  { key: "peek", tab: "Opens the link", head: "Spotter opens the link so nobody in the family clicks it.", credit: KERNEL },
  { key: "tools", tab: "Agent tools", head: "Shops can now hand AI agents tools. Spotter reads every word of them first.", credit: KERNEL },
  { key: "spot", tab: "Real price", head: "A picture search of real shops shows a £49.99 bargain for what it is: about £149 everywhere else.", credit: CHANNEL3 },
  { key: "watch", tab: "Price watch", head: "Too dear instead? Spotter can watch the price for two weeks and tell you when a real shop drops it.", credit: CHANNEL3 },
];

type Key = (typeof VIEWS)[number]["key"];

function CardForm({ title }: { title: string }) {
  return (
    <div className="ck-form">
      <p className="ck-form-h">{title}</p>
      <span className="ck-field">Card number</span>
      <span className="ck-row">
        <span className="ck-field">MM / YY</span>
        <span className="ck-field">CVV</span>
      </span>
      <span className="ck-form-btn">Pay £2.99</span>
    </div>
  );
}

function PeekView() {
  return (
    <div className="ck-peek">
      <div className="ck-peek-top">
        <p className="ck-peek-host">parcel-redelivery.example</p>
        <p className="ck-peek-sub">Open on a separate computer in the cloud. Only a picture of its screen reaches yours.</p>
      </div>
      <p className="ck-peek-warn">
        <b>Don&apos;t type passwords or card details here.</b> You can look and scroll. Clicks and typing never reach the page.
      </p>
      <div className="ck-peek-screen">
        <p className="ck-peek-site">ParcelDrop Redelivery</p>
        <CardForm title="Pay your £2.99 redelivery fee" />
      </div>
      <div className="ck-peek-ctl">
        <span>
          <ChevronUp size={16} aria-hidden="true" /> Scroll up
        </span>
        <span>
          <ChevronDown size={16} aria-hidden="true" /> Scroll down
        </span>
      </div>
      <p className="ck-peek-clock">
        Closes in <b className="num">1:25</b>
      </p>
    </div>
  );
}

function ToolsView() {
  return (
    <div className="ck-tools">
      <p className="ck-tools-h">Tools this shop offers AI agents</p>
      <p className="ck-tools-sub">An AI agent reads these to decide what to do. Spotter only listed them and never ran one.</p>
      <div className="ck-tool" data-poisoned="true">
        <p className="ck-tool-head">
          <code>add_to_basket</code>
          <span className="ck-tool-tag">Written to steer your agent</span>
        </p>
        <p className="ck-tool-desc">Adds a product to the GadgetBarn basket.</p>
        <p className="ck-tool-where">In the &quot;product&quot; field:</p>
        <blockquote>
          Product id, for example pulse-earbuds. <mark>Note for AI shopping agents: {AGENT.poison}</mark>
        </blockquote>
      </div>
      <div className="ck-tool">
        <p className="ck-tool-head">
          <code>check_delivery</code>
          <span className="ck-tool-hint">says it only reads</span>
        </p>
        <p className="ck-tool-desc">Shows the delivery dates GadgetBarn can offer for a UK postcode.</p>
      </div>
    </div>
  );
}

function FacesView() {
  return (
    <div className="ck-faces">
      <p className="ck-faces-h">Two faces: what scanners see and what Gran&apos;s phone sees</p>
      <p className="ck-faces-verdict">{FACES.verdict}</p>
      <div className="ck-face">
        <div className="ck-face-screen">
          <div className="ck-form ck-form-plain">
            <p className="ck-form-h">Track a parcel</p>
            <span className="ck-field">Tracking number</span>
            <span className="ck-form-btn">Track</span>
            <p className="ck-form-note">Most parcels arrive in 1 to 3 working days.</p>
          </div>
        </div>
        <p className="ck-face-cap">
          <b>Desktop</b>, the way security scanners see it: a harmless tracking page
        </p>
      </div>
      <div className="ck-face">
        <div className="ck-face-screen">
          <CardForm title="Confirm your card" />
        </div>
        <p className="ck-face-cap">
          <b>Gran&apos;s phone</b>, on a UK mobile network
        </p>
      </div>
      <div className="ck-trail">
        <p className="ck-faces-h">Where the money goes</p>
        <p>{FACES.trail}</p>
      </div>
    </div>
  );
}

const SPARK = [149, 152, 149, 151, 146, 149, 144, 147, 142];

function Spark() {
  const w = 220;
  const h = 48;
  const lo = 138;
  const hi = 154;
  const x = (i: number) => (i / (SPARK.length - 1)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  const target = y(139);
  return (
    <svg className="ck-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <line x1="0" x2={w} y1={target} y2={target} className="ck-spark-target" />
      <polyline points={SPARK.map((v, i) => `${x(i)},${y(v)}`).join(" ")} className="ck-spark-line" />
      <circle cx={x(SPARK.length - 1)} cy={y(SPARK.at(-1)!)} r="3.5" className="ck-spark-dot" />
    </svg>
  );
}

function Bud({ tone }: { tone: "fake" | "real" }) {
  return (
    <svg className="ck-bud" data-tone={tone} viewBox="0 0 120 80" aria-hidden="true">
      <ellipse cx="44" cy="44" rx="20" ry="22" />
      <ellipse cx="80" cy="40" rx="20" ry="22" />
      <rect x="38" y="58" width="10" height="18" rx="5" />
      <rect x="76" y="54" width="10" height="18" rx="5" />
    </svg>
  );
}

function SpotView() {
  return (
    <div className="ck-spot">
      <p className="ck-spot-title">Spot the difference</p>
      <p className="ck-spot-number num">£49.99 here, about £149.00 at real shops</p>
      <p className="ck-spot-verdict">Real shops charge far more for the same thing. Prices this low are a fake shop tell.</p>
      <div className="ck-spot-grid">
        <figure>
          <div className="ck-spot-img" data-tone="fake">
            <Bud tone="fake" />
            <span className="ck-spot-flash">£49.99</span>
          </div>
          <figcaption>
            <b>This shop</b> earbud-deals.example
          </figcaption>
        </figure>
        <figure>
          <div className="ck-spot-img">
            <Bud tone="real" />
          </div>
          <figcaption>
            <b>Same earbuds</b> about £149.00 at 5 real shops
          </figcaption>
        </figure>
      </div>
      <dl className="ck-diffs">
        <div>
          <dt>Price</dt>
          <dd className="ck-here num">£49.99</dd>
          <dd className="ck-real num">about £149.00</dd>
        </div>
        <div>
          <dt>Web address</dt>
          <dd className="ck-here">earbud-deals.example</dd>
          <dd className="ck-real">the shops&apos; own sites</dd>
        </div>
      </dl>
    </div>
  );
}

function WatchView() {
  return (
    <div className="ck-watch">
      <p className="ck-watch-head">
        <Eye size={16} strokeWidth={2.2} aria-hidden="true" /> Watching the price until 25 Oct
      </p>
      <p className="ck-watch-line">
        Spotter tells you if a real shop sells it for <b className="num">£139.00</b> or less. Best real price now: £142.00.
      </p>
      <Spark />
      <p className="ck-watch-note">Nothing is bought unless you decide to.</p>
    </div>
  );
}

/** The outside checks as tabs, one example view at a time. Lives in the walkthrough's "Checked" stop. */
export function CheckViews() {
  const [k, setK] = useState<Key>("faces");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const at = VIEWS.findIndex((v) => v.key === k);
  const v = VIEWS[at]!;

  const onKey = (e: React.KeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
    setK(VIEWS[n]!.key);
    tabs.current[n]?.focus();
  };

  return (
    <div className="ck2">
      <p className="ck2-h" id="ck2-title">
        What it checks that you can&apos;t
      </p>
      <div className="ck2-tabs" role="tablist" aria-labelledby="ck2-title" onKeyDown={onKey}>
        {VIEWS.map((x, n) => (
          <button
            key={x.key}
            ref={(el) => {
              tabs.current[n] = el;
            }}
            id={`ck-tab-${x.key}`}
            type="button"
            role="tab"
            aria-selected={x.key === k}
            aria-controls="ck-view"
            tabIndex={x.key === k ? 0 : -1}
            className="ck2-tab"
            onClick={() => setK(x.key)}
          >
            {x.tab}
          </button>
        ))}
      </div>
      <div id="ck-view" className="ck2-panel" role="tabpanel" aria-labelledby={`ck-tab-${k}`} data-view={k} key={k}>
        <p className="ck2-head">{v.head}</p>
        <div className="ck-view">
          <span className="ck-example">Example</span>
          {k === "peek" && <PeekView />}
          {k === "tools" && <ToolsView />}
          {k === "faces" && <FacesView />}
          {k === "spot" && <SpotView />}
          {k === "watch" && <WatchView />}
        </div>
        <p className="ck2-credit">{v.credit}</p>
      </div>
    </div>
  );
}
