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
