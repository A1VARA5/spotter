// The landing draws Spotter's messages by hand (the scenes are examples), so these tests make sure every line it
// quotes is what the product really sends. If a product message changes, this fails until the landing follows.
import { describe, expect, it } from "vitest";
import { askLines, notMeText, type WasItYou } from "@/core/was-it-you";
import type { Payment, Spender } from "@/core/lifecycle";
import { outcomeText } from "@/email/inbound";
import { reply } from "@/server/agent";
import { receiptLines, boardWords, type Receipt } from "@/watchtower/receipt";
import { GRAN_TEXT } from "@/watchtower/granLang";
import { HIDDEN_INSTRUCTION, TOOL_POISON } from "@/app/demo-shop/gadgetbarn/shop";
import { compareFaces } from "@/agents/twofaces";
import { moneyTrail, phoneTrail } from "@/agents/trail";
import { GRAN, TOM, AGENT, RECEIPT, GRAN_VIEW, SHOP, FACES, SAMPLE_BOARD } from "./copy";
import { sampleMonth } from "@/watchtower/sample";
import { toSources } from "@/watchtower/data";
import { DEMO_SPENDERS } from "@/server/seed";
import { WAS_IT_YOU_EXAMPLE } from "@/server/example-hold";
import { STORY_FLAGS } from "./Walkthrough";

describe("the landing's sample numbers match the live board's sample month", () => {
  it("adds up the same money kept, per outcome and for Gran", () => {
    const spenders = DEMO_SPENDERS.map((s, i) => ({ ...s, id: `sp_${i}`, household_id: "hh" })) as unknown as Spender[];
    const rows = toSources(sampleMonth(spenders), spenders).payments;
    const sum = (f: (r: (typeof rows)[number]) => boolean) => Math.round(rows.filter(f).reduce((t, r) => t + r.amount, 0) * 100) / 100;
    const kept = (r: (typeof rows)[number]) => r.outcome === "Stopped" || r.outcome === "Denied";
    expect(sum(kept)).toBe(SAMPLE_BOARD.kept);
    expect(rows.filter(kept)).toHaveLength(SAMPLE_BOARD.keptCount);
    expect(sum((r) => kept(r) && r.who === "Gran")).toBe(SAMPLE_BOARD.granKept);
    expect(sum((r) => r.outcome === "Paid")).toBe(SAMPLE_BOARD.paid);
    expect(sum((r) => r.outcome === "Stopped")).toBe(SAMPLE_BOARD.stopped);
    expect(sum((r) => r.outcome === "Denied")).toBe(SAMPLE_BOARD.denied);
    expect(sum((r) => r.outcome === "Protected")).toBe(SAMPLE_BOARD.protected);
  });
});

const pay = (over: Record<string, unknown>) =>
  ({
    id: "p1",
    amount: 25000,
    currency: "GBP",
    status: "needs_approval",
    request: { payee: { name: GRAN.payee }, context: `Forwarded from ${GRAN.from}: ${GRAN.text}` },
    decision: { reasons: [] },
    ...over,
  }) as unknown as Payment;

const wiy = { who: "Tom", claim: { quote: "it's Tom" } } as unknown as WasItYou;

describe("Was it you? scene", () => {
  it("asks Tom what the product asks", () => {
    const [q, quote] = askLines(pay({}), { name: "Gran" } as Spender, wiy);
    expect(TOM.question).toBe(q);
    expect(TOM.quote).toBe(quote);
  });

  it("tells Gran what the product tells her, before and after", () => {
    const [head] = outcomeText(pay({}), { spotter_name: "Sam" } as Spender, "https://x");
    expect(GRAN.held).toBe(head);
    expect(GRAN.notMe).toBe(notMeText(wiy, pay({})));
  });

  it("thanks Tom with the product's words", () => {
    expect(TOM.thanks).toBe("Thanks. Gran's £250.00 is safe: nothing was paid. Spotter is letting Gran know it wasn't you.");
  });
});

describe("the scroll story is the hero's text, all the way through", () => {
  it("quotes only words that are in Gran's text, from the same message the demo's Was it you? payment uses", () => {
    for (const f of STORY_FLAGS) expect(GRAN.text).toContain(f.quote);
    expect(WAS_IT_YOU_EXAMPLE.context).toContain(GRAN.text);
    expect(WAS_IT_YOU_EXAMPLE.context).toContain(GRAN.from);
    expect(WAS_IT_YOU_EXAMPLE.payee).toBe(GRAN.payee);
    expect(WAS_IT_YOU_EXAMPLE.amount).toBe(25000);
  });
});

describe("agent scene", () => {
  it("quotes the demo shop's poisoned tool and its hidden line", () => {
    expect(TOOL_POISON).toContain(AGENT.poison);
    expect(HIDDEN_INSTRUCTION).toContain(SHOP.hidden);
  });

  it("shows the reply the agent really gets when a payment is held", () => {
    const r = reply(
      pay({ amount: AGENT.amountPence, request: { payee: { name: AGENT.payee } }, decision: { reasons: AGENT.reasons } }),
      "Sam",
    );
    expect(r.status).toBe(AGENT.status);
    expect(r.message).toBe(AGENT.message);
  });
});

describe("two faces and where the money goes", () => {
  it("are what the code says for a page that only shows phones a card form", () => {
    const page = "https://parcel-redelivery.example/pay";
    const snap = (card: boolean, text: string) => ({ finalUrl: page, title: "Redelivery", text, visibleChars: text.length, asks: { card, bank: false, login: false, giftCard: false } });
    const r = compareFaces(snap(false, "Nothing to see here"), snap(true, "Confirm your card. Card number, expiry, CVV. Pay £1.99"), "uk_mobile");
    expect(r.compared && r.differs).toBe(true);
    expect(r.verdict).toBe(FACES.verdict);
    const desk = moneyTrail({ startUrl: page, finalUrl: page, forms: [], scriptTargets: [], items: null });
    const phone = moneyTrail({ startUrl: page, finalUrl: page, forms: [{ action: "https://collect-pay.example/c", money: true }], scriptTargets: [], items: null });
    expect(phoneTrail(desk, phone).line).toBe(FACES.trail);
  });
});

describe("Watchtower receipt", () => {
  it("uses the receipt's own words", () => {
    const r = { tools: [], flagged: false, moneyActions: 0, unknown: [], boardChanges: RECEIPT.boardChanges, boardKnown: true } as unknown as Receipt;
    expect(receiptLines(r).money).toBe(RECEIPT.moneyLine);
    expect(boardWords(r).replace(/\.$/, "")).toBe(RECEIPT.board);
  });
});

describe("Gran's view", () => {
  it("is word for word what the simple view says, in both languages", () => {
    for (const lang of ["en", "pl"] as const) {
      const v = GRAN_VIEW[lang];
      expect(v.safeTitle).toBe(GRAN_TEXT.safeTitle[lang]);
      expect(v.keptBefore).toBe(GRAN_TEXT.keptBefore[lang]);
      expect(v.keptAfter).toBe(GRAN_TEXT.keptAfter[lang]);
      expect(v.byStopped).toBe(GRAN_TEXT.byStopped[lang]);
      expect(v.trick).toBe(GRAN_TEXT.trickPretend[lang]);
      expect(v.receiptTitle).toBe(GRAN_TEXT.receiptTitle[lang]);
      expect(v.looked).toBe(GRAN_TEXT.lookedOnce[lang] + GRAN_TEXT.took[lang].replace("{s}", "3"));
      expect(v.receiptMoney).toBe(GRAN_TEXT.receiptMoney[lang]);
      expect(v.sample).toBe(GRAN_TEXT.sample[lang]);
      expect(v.to).toBe(GRAN_TEXT.to[lang]);
    }
  });
});
