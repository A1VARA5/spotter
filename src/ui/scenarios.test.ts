import { describe, expect, it, vi } from "vitest";
import { BUSINESS_SCENARIOS, SCENARIOS, scenariosFor } from "./scenarios";
import { DEMO_SPENDERS } from "@/server/seed";
import { PRESETS } from "@/core/presets";
import { aiCheck } from "@/ai/check";
import { checkRules } from "@/core/rules";
import { decide } from "@/core/decide";
import type { Allowance, PaymentRequest } from "@/core/types";
import type { Scenario } from "./scenarios";

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

  it("the buying agent's overpriced paper order is held, not stopped, for a business and for the demo family's agent", async () => {
    const paper = BUSINESS_SCENARIOS.find((s) => s.id === "biz-paper")!;
    expect(paper.body.context).toMatch(/usual/i);
    expect((await outcome(paper, PRESETS.buyer.allowance)).outcome).toBe("ask");
    expect((await outcome(paper, DEMO_SPENDERS.find((s) => s.kind === "agent")!.allowance)).outcome).toBe("ask");
  });
});
