import { describe, expect, it } from "vitest";
import type { WatchView } from "@/core/watch";
import type { Spender } from "@/core/lifecycle";
import { toWatchRows } from "./data";
import { sampleWatches, SAMPLE_WATCH_PREFIX } from "./sample";
import { watchSummary } from "./widgetLogic";

const NOW = new Date("2026-10-11T12:00:00Z");
const view = (over: Partial<WatchView>): WatchView => ({
  id: "watch_1",
  paymentId: null,
  who: "Gran",
  item: "Over ear wireless headphones",
  title: "Over ear wireless headphones (example)",
  currency: "GBP",
  nearlyPaid: 8900,
  target: 7600,
  best: { price: 6900, shop: "harbourline-audio.co.uk", url: "" },
  saving: 2000,
  status: "dropped",
  history: null,
  createdAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-10-15T00:00:00Z",
  lastCheckedAt: null,
  example: true,
  createdBy: "spotter",
  ...over,
});

describe("toWatchRows", () => {
  it("turns watches into flat rows in pounds, drops first, with sample and example marked", () => {
    const rows = toWatchRows([view({ id: "w_watching", status: "watching", saving: null, example: false, best: { price: 15900, shop: "fair.co.uk", url: "" }, nearlyPaid: 21900, target: 15400 }), view({ id: "w_drop" })]);
    expect(rows.map((r) => r.id)).toEqual(["w_drop", "w_watching"]);
    expect(rows[0]).toMatchObject({ who: "Gran", status: "Dropped", nearlyPaid: 89, target: 76, bestPrice: 69, shop: "harbourline-audio.co.uk", saving: 20, example: "Yes", sample: "No" });
    expect(rows[1]).toMatchObject({ status: "Watching", saving: 0, example: "No" });
  });
});

describe("sampleWatches", () => {
  const agent: Spender = { id: "sp_a", household_id: "hh", name: "Shopping agent", kind: "agent", spotter_name: "Sam", email: null, telegram_chat_id: null, discord_user_id: null, allowance: { weekly: { amount: 1, currency: "GBP" }, askAbove: { amount: 1, currency: "GBP" }, blockedCategories: [], allowedPayees: [], blockedPayees: [] } };

  it("gives demo families one sample watch for their agent, marked by its id", () => {
    const w = sampleWatches([agent], NOW);
    expect(w).toHaveLength(1);
    expect(w[0]!.id.startsWith(SAMPLE_WATCH_PREFIX)).toBe(true);
    expect(toWatchRows(w)[0]).toMatchObject({ sample: "Yes", status: "Watching", who: "Shopping agent" });
  });

  it("is empty without an agent", () => {
    expect(sampleWatches([], NOW)).toEqual([]);
  });
});

describe("watchSummary", () => {
  it("adds up what the drops would save and counts what is still watched", () => {
    const rows = toWatchRows([view({ id: "a" }), view({ id: "b", status: "watching", saving: null }), view({ id: "c", status: "expired", saving: null })]);
    expect(watchSummary(rows)).toMatchObject({ watching: 1, dropped: 1, saved: 20, headline: "£20 less than nearly paid, from 1 price drop" });
  });

  it("says plainly when nothing has dropped yet", () => {
    expect(watchSummary(toWatchRows([view({ status: "watching", saving: null })])).headline).toBe("Watching 1 price");
    expect(watchSummary([]).headline).toBe("No price watches yet");
  });
});
