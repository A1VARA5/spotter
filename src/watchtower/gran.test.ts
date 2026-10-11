import { describe, expect, it } from "vitest";
import { ADVICE, GRAN_PAIRS, GRAN_TOKENS, contrast, granBoard, granForAgent, granLabels, granMonth, granThemeParams, plainSentence, type GranRow } from "./gran";
import type { CaseNote, PersonRow } from "./data";

const person = (name: string, kind: string): PersonRow => ({ name, kind, weeklyAllowance: 100, spentThisWeek: 0 });
const NOW = new Date("2026-10-11T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const row = (o: Partial<GranRow> & Pick<GranRow, "id" | "outcome">): GranRow => ({ when: ago(5), who: "Margaret", payee: "Somebody", amount: 10, topSign: "None", sample: "No", ...o });
const note = (id: string, reasons: string[], signs: string[] = []): CaseNote => ({ id, reasons, signs: signs.map((sign) => ({ sign, severity: "high", why: "" })) });

describe("which name the simple view goes by", () => {
  it("uses the first person the family looks out for", () => {
    const l = granLabels([person("Shopping agent", "AI agent"), person("Margaret", "Person"), person("Leo", "Kid")], "family", "Sam");
    expect(l).toEqual({ who: "Margaret", viewLabel: "Margaret's view", waitingTitle: "Waiting for Sam", spotter: "Sam" });
  });

  it("falls back to a kid when there is no older relative", () => {
    expect(granLabels([person("Leo", "Kid")], "family", "Sam").viewLabel).toBe("Leo's view");
  });

  it("says Simple view for a family of only agents, and for a business", () => {
    expect(granLabels([person("Shopping agent", "AI agent")], "family", "Sam")).toMatchObject({ who: null, viewLabel: "Simple view" });
    expect(granLabels([person("Margaret", "Person")], "business", "Sam")).toMatchObject({ who: null, viewLabel: "Simple view" });
  });

  it("copes with a blank spotter name and trims long or padded names", () => {
    const l = granLabels([person("  Margaret Elizabeth Montgomery Smythe  ", "Person")], "family", "  ");
    expect(l.waitingTitle).toBe("Waiting for your spotter");
    expect(l.spotter).toBe("your spotter");
    expect(l.who).toBe("Margaret Elizabeth Montgomery Smythe");
    expect(l.viewLabel.length).toBeLessThanOrEqual(30);
    expect(l.viewLabel).toBe("Margaret's view");
  });
});

describe("plain sentences for an older reader", () => {
  it("keeps only the first sentence", () => {
    expect(plainSentence("This looks like a scam. Don't pay at all, not even with buyer protection.")).toBe("This looks like a scam.");
  });

  it("never shows payment or PayPal ids", () => {
    const s = plainSentence("Held pay_abc123XYZ because order 8DD59221E7921940H looked odd.");
    expect(s).not.toMatch(/pay_|8DD59221E7921940H/);
    expect(s).toBe("Held because order looked odd.");
  });

  it("caps very long text at a word", () => {
    const s = plainSentence("word ".repeat(80));
    expect(s.length).toBeLessThanOrEqual(141);
    expect(s.endsWith("…")).toBe(true);
  });

  it("returns empty for nothing useful", () => {
    expect(plainSentence("   ")).toBe("");
  });
});

describe("the month as Gran sees it", () => {
  const rows: GranRow[] = [
    row({ id: "p1", outcome: "Stopped", payee: "New number (Hi Mum)", amount: 400, when: ago(3), topSign: "Pretending to be someone" }),
    row({ id: "p2", outcome: "Denied", payee: "parcel-redelivery.co", amount: 2.99, when: ago(20), topSign: "Pretending to be someone" }),
    row({ id: "p3", outcome: "Waiting", payee: "Dave", amount: 85, when: ago(2) }),
    row({ id: "p4", outcome: "Waiting", payee: "Older hold", amount: 20, when: ago(30) }),
    row({ id: "p5", outcome: "Paid", payee: "FreshCrate", amount: 64.2 }),
    row({ id: "p6", outcome: "Stopped", who: "Leo", payee: "free-blockcoins.gg", amount: 9.99, topSign: "Gift cards or crypto" }),
    row({ id: "p7", outcome: "Stopped", payee: "Last spring", amount: 50, when: ago(24 * 45) }),
  ];
  const notes = new Map([
    ["p1", note("p1", ["A stranger was pretending to be family. Ring them."], ["Pretending to be someone", "Pressure to hurry"])],
    ["p2", note("p2", [], ["Pretending to be someone"])],
  ]);
  const m = granMonth(rows, notes, { who: "Margaret", spotter: "Sam", now: NOW });

  it("in Polish: tells each stop by its trick (hand translated), never by Spotter's English reason", () => {
    const pl = granMonth(rows, notes, { who: "Margaret", spotter: "Sam", now: NOW, lang: "pl" });
    expect(pl.kept).toBeCloseTo(402.99);
    expect(pl.stopped[0]).toMatchObject({ sentence: "Udawali kogoś, komu ufasz.", by: "Spotter ją zatrzymał" });
    expect(pl.stopped[1]!.by).toBe("Sam powiedział(a) nie");
    expect(pl.waiting[0]!.status).toBe("Poprosiliśmy o decyzję: Sam. Do tego czasu PayPal trzyma pieniądze bezpiecznie.");
    expect(pl.tricks[0]!.plain).toBe("Udawali kogoś, komu ufasz.");
    expect(JSON.stringify(pl)).not.toContain("A stranger was pretending");
    const forAgent = granForAgent(pl, NOW, "pl");
    expect(forAgent.advice).toBe("Nie płać. Zadzwoń do tej osoby na numer, który już masz, a nie na numer z wiadomości.");
  });

  it("adds up only this person's stopped and denied money from the last 30 days", () => {
    expect(m.kept).toBeCloseTo(402.99);
    expect(m.stopped.map((s) => s.id)).toEqual(["p1", "p2"]);
  });

  it("gives one plain sentence per stop, from Spotter's own reasons or a calm default", () => {
    expect(m.stopped[0]).toMatchObject({ payee: "New number (Hi Mum)", amount: 400, sentence: "A stranger was pretending to be family.", by: "Spotter stopped it" });
    expect(m.stopped[1]).toMatchObject({ by: "Sam said no", sentence: "Sam said no, so nothing was paid." });
  });

  it("lists held payments oldest first with a plain status that never asks Gran to do anything", () => {
    expect(m.waiting.map((w) => w.id)).toEqual(["p4", "p3"]);
    for (const w of m.waiting) {
      expect(w.status).toMatch(/Sam/);
      expect(w.status).not.toMatch(/approve/i);
    }
  });

  it("a held payment someone is sleeping on says when Spotter asks again, and when the money comes back on its own", () => {
    const n = new Map([["w1", { ...note("w1", []), wait: { askAgain: "Monday 12 October at 9am", holdEnds: "Monday 9 November at 12:11am" } }]]);
    const [w] = granMonth([row({ id: "w1", outcome: "Waiting" })], n, { who: null, spotter: "Sam", now: NOW }).waiting;
    expect(w!.status).toBe("Sleeping on it. Spotter asks Sam again Monday 12 October at 9am. The money stays put until then.");
    expect(w!.ends).toBe("If nobody says yes by Monday 9 November at 12:11am, the money comes back to you.");
    expect(w!.asleep).toBe(true);
    const [plain] = granMonth([row({ id: "w2", outcome: "Waiting" })], new Map([["w2", { ...note("w2", []), wait: { holdEnds: "Monday 9 November at 12:11am" } }]]), { who: null, spotter: "Sam", now: NOW }).waiting;
    expect(plain!.asleep).toBe(false);
    expect(plain!.status).toMatch(/Sam has been asked/);
  });

  it("turns scam signs into the tricks they used, most common first, in plain words", () => {
    expect(m.tricks[0]).toMatchObject({ sign: "Pretending to be someone", count: 2 });
    expect(m.tricks[0]!.plain).toMatch(/pretended to be someone you trust/i);
    expect(m.tricks.map((t) => t.sign)).toContain("Pressure to hurry");
    expect(m.tricks.map((t) => t.sign)).not.toContain("Gift cards or crypto");
  });

  it("shows everyone when there is no one person to focus on", () => {
    const all = granMonth(rows, notes, { who: null, spotter: "Sam", now: NOW });
    expect(all.stopped.map((s) => s.id)).toContain("p6");
  });

  it("is empty but valid with no rows", () => {
    expect(granMonth([], new Map(), { who: "Margaret", spotter: "Sam", now: NOW })).toEqual({ kept: 0, stopped: [], waiting: [], tricks: [] });
  });

  it("hands the agent the month without a single id, with days ago instead of timestamps", () => {
    const b = granForAgent(m, NOW);
    const text = JSON.stringify(b);
    for (const id of ["p1", "p2", "p3", "p4"]) expect(text).not.toContain(`"${id}"`);
    expect(text).not.toMatch(/"id"/);
    expect(b.keptThisMonth).toBe("£402.99");
    expect(b.stopped[0]).toMatchObject({ payee: "New number (Hi Mum)", amount: "£400.00", daysAgo: 0, why: "A stranger was pretending to be family." });
    expect(b.waiting[0]).toMatchObject({ payee: "Older hold", daysAgo: 1 });
    expect(b.advice).toBe(ADVICE);
  });

  it("keeps the advice line the rest of Spotter uses", () => {
    expect(ADVICE).toMatch(/number you already have/);
    expect(ADVICE).toMatch(/^Don't pay/);
  });
});

describe("the simple view's theme", () => {
  it("measures contrast the WCAG way", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("every text colour pair passes WCAG AA for normal text (4.5:1)", () => {
    expect(GRAN_PAIRS.length).toBeGreaterThanOrEqual(6);
    for (const [fg, bg] of GRAN_PAIRS) expect(contrast(GRAN_TOKENS[fg], GRAN_TOKENS[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("uses large type and roomy rows through AG Studio's theme params", () => {
    const p = granThemeParams();
    expect(p.fontSize).toBeGreaterThanOrEqual(20);
    expect(p.gridCellFontSize).toBeGreaterThanOrEqual(20);
    expect(p.gridRowHeight).toBeGreaterThanOrEqual(56);
    expect(p.studioWidgetTitleFontSize).toBeGreaterThanOrEqual(24);
    expect(p.chartFontSize).toBeGreaterThanOrEqual(16);
    expect(p.textColor).toBe(GRAN_TOKENS.ink);
  });
});

describe("the simple view's board", () => {
  it("has the three plain widgets and a payments table focused on the person", () => {
    const b = granBoard("Margaret") as unknown as { pages: Array<{ widgets: Record<string, { type: string }>; filter?: { widget?: Record<string, unknown> } }> };
    expect(b.pages).toHaveLength(1);
    const types = Object.values(b.pages[0]!.widgets).map((w) => w.type);
    expect(types).toEqual(expect.arrayContaining(["gran-safe", "gran-waiting", "gran-scams", "grid"]));
    expect(types.some((t) => /chart/.test(t))).toBe(false);
    expect(JSON.stringify(b.pages[0]!.filter)).toContain("Margaret");
  });

  it("reads in one column, and gives phones taller tiles without overlaps", () => {
    type L = Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }>;
    const layout = (phone: boolean) => (granBoard("Margaret", phone) as unknown as { pages: Array<{ widgetLayout: L }> }).pages[0]!.widgetLayout;
    for (const phone of [false, true]) {
      const boxes = Object.values(layout(phone)).sort((a, b) => a.yTrack - b.yTrack);
      boxes.forEach((b, i) => {
        expect(b.xSpan).toBe(24);
        if (i) expect(b.yTrack).toBe(boxes[i - 1]!.yTrack + boxes[i - 1]!.ySpan);
      });
    }
    expect(layout(true).safe!.ySpan).toBeGreaterThan(layout(false).safe!.ySpan);
  });

  it("has no filter when there is no one person", () => {
    const b = granBoard(null) as unknown as { pages: Array<{ filter?: unknown }> };
    expect(b.pages[0]!.filter).toBeUndefined();
  });

  it("names the page and the table in Gran's language, and shows outcomes in it", () => {
    type P = { pages: Array<{ name: string; widgets: Record<string, { dataMapping: { cols?: Array<{ id: string }> }; format?: { title: { text: string } } }> }> };
    const pl = granBoard("Margaret Jones", false, "pl") as unknown as P;
    expect(pl.pages[0]!.name).toBe("Ten miesiąc");
    expect(pl.pages[0]!.widgets.payments!.format!.title.text).toBe("Płatności: Margaret");
    expect(pl.pages[0]!.widgets.payments!.dataMapping.cols!.map((c) => c.id)).toContain("payments.outcomeText");
    expect((granBoard("Margaret") as unknown as P).pages[0]!.name).toBe("This month");
  });
});
