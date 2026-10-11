import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceWatch } from "./PriceWatch";
import type { WatchView } from "@/core/watch";

const w: WatchView = {
  id: "watch_1",
  paymentId: "pay_1",
  who: "Shopping agent",
  item: "wireless earbuds",
  title: "Earbuds Pro",
  currency: "GBP",
  nearlyPaid: 24900,
  target: 21900,
  best: { price: 22900, shop: "currys.co.uk", url: "https://www.currys.co.uk/p/1" },
  saving: null,
  status: "watching",
  history: null,
  createdAt: "2026-10-11T10:00:00Z",
  expiresAt: "2026-10-25T10:00:00Z",
  lastCheckedAt: null,
  example: false,
  createdBy: "spotter",
};
const html = (watch: WatchView, updates?: "on_change" | "daily") => renderToStaticMarkup(createElement(PriceWatch, { watch, paymentId: "pay_1", updates }));

// 4b: a watch started live says so, with its target and where the prices come from, and never claims more than the
// checks it really gets (daily, unless Channel3's price change webhook is set up).
describe("a live price watch", () => {
  it("is marked live, names its target and Channel3, and says it is checked daily when there is no webhook", () => {
    const out = html(w, "daily");
    expect(out).toContain(">Live<");
    expect(out).toContain("£219.00");
    expect(out).toContain("Channel3");
    expect(out).toMatch(/checks (it|the price) every day/);
    expect(out).not.toMatch(/within minutes/);
  });

  it("says Channel3 tells Spotter when the price changes only when the webhook is set up", () => {
    expect(html(w, "on_change")).toMatch(/when it sees the price change, usually within minutes/);
  });

  it("leaves the live mark off the labelled example", () => {
    const out = html({ ...w, example: true }, "daily");
    expect(out).not.toContain(">Live<");
    expect(out).toContain("Example, checked earlier");
  });
});

// The panel in the dashboard's Price watches dialog: one heading per watch, current best against what was nearly
// paid, a labelled chart, the source, and one status badge. The dialog says "never buys" once, so the panel doesn't.
describe("the price watch panel", () => {
  const dropped: WatchView = {
    ...w,
    who: "Gran",
    item: "Over ear wireless headphones",
    nearlyPaid: 8900,
    target: 7600,
    best: { price: 6900, shop: "harbourline-audio.co.uk", url: "" },
    saving: 2000,
    status: "dropped",
    example: true,
    history: {
      source: "checks",
      points: [
        { at: "2026-10-01T09:00:00Z", price: 8900 },
        { at: "2026-10-05T09:00:00Z", price: 8400 },
        { at: "2026-10-11T09:00:00Z", price: 6900 },
      ],
    },
  };
  const panel = (watch: WatchView, updates?: "on_change" | "daily") => renderToStaticMarkup(createElement(PriceWatch, { watch, variant: "panel", updates }));

  it("puts the item first, then the best price now against what was nearly paid", () => {
    const out = panel(dropped);
    expect(out.match(/<h3/g)?.length).toBe(1);
    expect(out).toContain(">Over ear wireless headphones</h3>");
    expect(out).toMatch(/Best price now.*£69\.00.*harbourline-audio\.co\.uk/s);
    expect(out).toMatch(/Gran nearly paid.*£89\.00/s);
    expect(out).toContain("£20.00 less");
  });

  it("draws the price line with labelled axis points and says it in words too", () => {
    const out = panel(dropped);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Price went from £89.00 on 1 Oct to £69.00 on 11 Oct. Target £76.00."');
    for (const label of [">£89<", ">£69<", ">1 Oct<", ">11 Oct<", ">Target £76<"]) expect(out).toContain(label);
  });

  it("shows one status badge, names Channel3, and leaves the never buys line to the dialog", () => {
    const out = panel(dropped);
    expect(out.match(/class="pw-badge/g)?.length).toBe(1);
    expect(out).toContain(">Example, checked earlier<");
    expect(out).toContain("Channel3");
    expect(out).not.toMatch(/never buys|Nothing is bought/);
    expect(out).not.toContain(" · ");
  });

  it("marks a live watch Live, with its target, how it is checked, and a way to stop", () => {
    const out = renderToStaticMarkup(createElement(PriceWatch, { watch: w, variant: "panel", updates: "daily", paymentId: "pay_1" }));
    expect(out).toContain(">Live<");
    expect(out).toContain("Watching until 25 Oct for <b>£219.00</b> or less");
    expect(out).toMatch(/checks (it|the price) every day/);
    expect(out).toContain("Stop watching");
  });
});
