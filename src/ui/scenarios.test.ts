import { describe, expect, it, vi } from "vitest";
import { BUSINESS_SCENARIOS, SCENARIOS, scenariosFor } from "./scenarios";
import { DEMO_SPENDERS } from "@/server/seed";
import { PRESETS } from "@/core/presets";
import { aiCheck } from "@/ai/check";
import { checkRules } from "@/core/rules";
import { decide } from "@/core/decide";
import type { Allowance, PaymentRequest } from "@/core/types";
import type { Scenario } from "./scenarios";
import { OUTCOME_WORDS } from "./labels";

// Third party names a demo video must not show. Spotter's own integrations (PayPal, Telegram...) are fine.
const BRANDS = /tesco|roblox|robux|steam|spotify|boots|ocado|waitrose|amazon|etsy|uber|apple|sony|currys|john lewis|whatsapp|royal mail|hmrc|facebook|marketplace|gmail|outlook|iphone|ipad|airpods|netflix/i;

const request = (s: Scenario): PaymentRequest => ({
  id: "p",
  spenderId: "s",
  money: { amount: s.body.amount, currency: s.body.currency },
  payee: { name: s.body.payee, isNew: s.body.payeeIsNew },
  category: s.body.category,
  method: s.body.method,
  item: s.body.item,
  context: s.body.context,
  createdAt: "2026-10-10T12:00:00Z",
});
const full = (a: Omit<Allowance, "spentThisWeek">): Allowance => ({ ...a, spentThisWeek: { amount: 0, currency: "GBP" } });
const noFlags = vi.fn(async () => ({ summary: "Looks fine.", injection_attempt: false, flags: [] }));

async function outcome(s: Scenario, a: Omit<Allowance, "spentThisWeek">) {
  const req = request(s);
  const ai = await aiCheck(req, noFlags);
  return decide(checkRules(req, full(a)), ai, { amount: req.money.amount, askAbove: a.askAbove.amount });
}

describe("scenarios", () => {
  it("never names a real shop or app", () => {
    expect(JSON.stringify([SCENARIOS, BUSINESS_SCENARIOS, DEMO_SPENDERS])).not.toMatch(BRANDS);
  });

  it("families see the family ones first and the business ones under their own heading; a business sees only its own", () => {
    expect(scenariosFor("family")).toEqual({ main: SCENARIOS, extra: BUSINESS_SCENARIOS });
    expect(scenariosFor("business")).toEqual({ main: BUSINESS_SCENARIOS, extra: [] });
    expect(BUSINESS_SCENARIOS.map((s) => s.id)).toEqual(["biz-invoice", "biz-paper"]);
  });

  it("the changed bank details invoice is switched to a protected payment, with ring the supplier advice, even with a quiet model", async () => {
    const invoice = BUSINESS_SCENARIOS.find((s) => s.id === "biz-invoice")!;
    for (const a of [PRESETS.staff.allowance, PRESETS.relative.allowance]) {
      const d = await outcome(invoice, a);
      expect(d.outcome).toBe("protect");
      expect(d.reasons[0]).toMatch(/ring the supplier/i);
    }
  });

  it("the booby trapped shop links the live GadgetBarn demo page (for the cloud browser) and is still stopped by code alone", async () => {
    const trap = SCENARIOS.find((s) => s.id === "agent-trap")!;
    expect(trap.body.context).toContain("https://spotter-pay.vercel.app/demo-shop/gadgetbarn");
    expect(trap.spender).toBe("agent");
    const d = await outcome(trap, DEMO_SPENDERS.find((s) => s.kind === "agent")!.allowance);
    expect(d.outcome).toBe("block");
  });

  it("every demo scenario keeps its documented outcome whatever order a judge clicks them in", async () => {
    // What each card promises, with a quiet model (the real check can only make things stricter).
    const promised: Record<string, string> = {
      "agent-gift": "allow", "agent-big": "ask", "agent-too-cheap": "ask", "agent-trap": "block",
      "gran-hi-mum": "ask", "gran-redelivery": "ask", "gran-seller": "protect", "gran-chemist": "allow", "leo-giftcard": "block",
      "biz-invoice": "protect", "biz-paper": "ask",
    };
    const all = [...SCENARIOS, ...BUSINESS_SCENARIOS];
    expect(Object.keys(promised).sort()).toEqual(all.map((s) => s.id).sort());
    const counts = new Set(["allow", "ask"]); // paid or held money uses the allowance; protected and blocked don't
    const orders = [all, [...all].reverse(), [...all.slice(5), ...all.slice(0, 5)]];
    // Hi Mum and the earbuds are the ones a judge most often sends twice.
    const twice = [...all, ...all.filter((s) => s.id === "gran-hi-mum" || s.id === "agent-big")];
    const twiceFirst = [...twice.slice(all.length), ...all];
    for (const order of [...orders, twice, twiceFirst]) {
      // The demo family starts with the example hold (Gran, £250) already using some of her week.
      const spent: Record<string, number> = { person: SCENARIOS.find((s) => s.id === "gran-hi-mum")!.body.amount };
      for (const s of order) {
        const seed = DEMO_SPENDERS.find((d) => d.kind === s.spender)!;
        const req = request(s);
        const ai = await aiCheck(req, noFlags);
        const a = { ...seed.allowance, spentThisWeek: { amount: spent[s.spender] ?? 0, currency: "GBP" as const } };
        const d = decide(checkRules(req, a), ai, { amount: req.money.amount, askAbove: a.askAbove.amount });
        expect(`${s.id}: ${d.outcome}`).toBe(`${s.id}: ${promised[s.id]}`);
        if (counts.has(d.outcome)) spent[s.spender] = (spent[s.spender] ?? 0) + req.money.amount;
      }
    }
  });

  it("the buying agent's overpriced paper order is held, not stopped, for a business and for the demo family's agent", async () => {
    const paper = BUSINESS_SCENARIOS.find((s) => s.id === "biz-paper")!;
    expect(paper.body.context).toMatch(/usual/i);
    expect((await outcome(paper, PRESETS.buyer.allowance)).outcome).toBe("ask");
    expect((await outcome(paper, DEMO_SPENDERS.find((s) => s.kind === "agent")!.allowance)).outcome).toBe("ask");
  });

  it("each expected line starts with the app's own word for that outcome", () => {
    const word: Record<string, string> = {
      "agent-gift": OUTCOME_WORDS.paid.long, "gran-chemist": OUTCOME_WORDS.paid.long,
      "agent-big": OUTCOME_WORDS.held.long, "agent-too-cheap": OUTCOME_WORDS.held.long, "gran-hi-mum": OUTCOME_WORDS.held.long, "gran-redelivery": OUTCOME_WORDS.held.long,
      "agent-trap": OUTCOME_WORDS.blocked.long, "leo-giftcard": OUTCOME_WORDS.blocked.long,
      "gran-seller": OUTCOME_WORDS.protected.long, "biz-invoice": OUTCOME_WORDS.protected.long,
      "biz-paper": "Waiting for the owner",
    };
    for (const s of [...SCENARIOS, ...BUSINESS_SCENARIOS]) expect(`${s.id}: ${s.expect}`).toMatch(new RegExp(`^${s.id}: ${word[s.id]}\\b`));
  });

  it("tags the scenarios that show the cloud browser and real shop prices, and only those", () => {
    const shows = (id: string) => [...SCENARIOS, ...BUSINESS_SCENARIOS].find((s) => s.id === id)!.shows?.map((t) => t.engine) ?? [];
    expect(shows("agent-trap")).toContain("KERNEL");
    expect(shows("gran-redelivery")).toContain("KERNEL");
    for (const id of ["agent-big", "agent-too-cheap", "biz-paper"]) expect(shows(id)).toContain("Channel3");
    for (const s of [...SCENARIOS, ...BUSINESS_SCENARIOS]) {
      // A KERNEL tag needs a link to open; a Channel3 tag needs a product to price.
      if (shows(s.id).includes("KERNEL")) expect(s.body.context).toMatch(/https:\/\//);
      if (shows(s.id).includes("Channel3")) expect(s.body.item).toBeTruthy();
    }
    expect(shows("gran-chemist")).toEqual([]);
  });
});
