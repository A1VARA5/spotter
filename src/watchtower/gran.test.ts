import { describe, expect, it } from "vitest";
import { ADVICE, GRAN_PAIRS, GRAN_TOKENS, contrast, granBoard, granForAgent, granLabels, granMonth, granThemeParams, plainSentence, type GranRow } from "./gran";
import type { CaseNote, PersonRow } from "./data";
import { pointables } from "./point";

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
    expect(granMonth([], new Map(), { who: "Margaret", spotter: "Sam", now: NOW })).toEqual({ kept: 0, keptSample: 0, stopped: [], waiting: [], tricks: [] });
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

  it("gives each item the handle point_at uses, the same ones pointables makes", () => {
    const b = granForAgent(m, NOW);
    const handles = pointables(m, { lang: "en", spotter: "Sam", now: NOW }).map((i) => i.handle);
    const told = [...b.stopped, ...b.waiting, ...b.tricks].map((x) => x.handle).concat(b.keptHandle, b.adviceHandle);
    expect(told).toEqual(handles);
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

describe("who decided, and why, in Gran's words", () => {
  const parcelNote: CaseNote = {
    id: "parcel",
    reasons: ["First time paying Larkhill Parcels.", "A tight deadline is used to rush you before you can check whether the parcel is real."],
    signs: [
      { sign: "Pressure to hurry", severity: "medium", why: "A tight deadline is used to rush you before you can check whether the parcel is real." },
      { sign: "Pretending to be someone", severity: "medium", why: "Scammers often pretend to be delivery companies by text." },
    ],
    caseHeadline: 'This looks like a fake parcel text: it uses a small £1.99 "redelivery fee" to get Gran\'s card details.',
  };

  // R5-N1: Gran read "Example, checked earlier: this looks like the Hi Mum scam. Tom said "not me". Just now."
  it("tells a Not me stop by what happened: someone said they were the relative, and the relative said no", () => {
    const notes = new Map([["tom", note("tom", ["Someone on a new number says they're Tom."])]]);
    const m = granMonth([row({ id: "tom", who: "Gran", outcome: "Denied", amount: 250, wasItYou: "Tom: not me" })], notes, { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped[0]!.sentence).toBe("Someone said they were Tom. The real Tom said they never sent it.");
    expect(m.stopped[0]!.by).toBe("Nothing was paid");
  });

  it("never shows the example's 'checked earlier' words beside a time: the row is tagged Example instead", () => {
    const ex: CaseNote = { id: "ex", reasons: ["Example, checked earlier. Someone pretending to be family."], signs: [], caseHeadline: "Example, checked earlier: this looks like the Hi Mum scam. Someone says they're family on a new number." };
    const m = granMonth([row({ id: "ex", outcome: "Denied", amount: 250 })], new Map([["ex", ex]]), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped[0]!.sentence).toBe("This looks like the Hi Mum scam.");
    expect(m.stopped[0]!.example).toBe(true);
    const live = granMonth([row({ id: "l", outcome: "Denied" })], new Map([["l", note("l", ["Looks like a scam."])]]), { who: null, spotter: "Sam", now: NOW });
    expect(live.stopped[0]!.example).toBe(false);
  });

  it("shows one row for repeats of the same payment (same payee and amount), newest first, with how many times", () => {
    const rows = [
      row({ id: "a", outcome: "Denied", payee: "jamie.k1994@mail.example", amount: 250, when: ago(1), wasItYou: "Tom: not me" }),
      row({ id: "b", outcome: "Denied", payee: "Jamie.k1994@mail.example ", amount: 250, when: ago(2), wasItYou: "Tom: not me" }),
      row({ id: "c", outcome: "Denied", payee: "Larkhill Parcels", amount: 1.99, when: ago(1.5) }),
      row({ id: "d", outcome: "Waiting", payee: "jamie.k1994@mail.example", amount: 250, when: ago(0.5) }),
    ];
    const m = granMonth(rows, new Map(), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped.map((s) => [s.id, s.times])).toEqual([
      ["a", 2],
      ["c", 1],
    ]);
    // every stop still counts towards the money kept, and the one still waiting stays in its own list
    expect(m.kept).toBe(501.99);
    expect(m.waiting.map((w) => w.id)).toEqual(["d"]);
    expect(granForAgent(m, NOW).stopped[0]).toMatchObject({ times: 2 });
    // the assistant says the same total as the screen
    expect(granForAgent(m, NOW).keptThisMonth).toBe("£501.99");
  });

  it("never hides a live stop under the Example tag when it repeats the example's payee and amount", () => {
    const ex: CaseNote = { id: "ex", reasons: [], signs: [], caseHeadline: "Example, checked earlier: this looks like the Hi Mum scam." };
    const rows = [row({ id: "live", outcome: "Denied", payee: "jamie", amount: 250, when: ago(2) }), row({ id: "ex", outcome: "Denied", payee: "jamie", amount: 250, when: ago(1) })];
    const m = granMonth(rows, new Map([["ex", ex], ["live", note("live", ["Looks like the Hi Mum scam."])]]), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped).toHaveLength(1);
    expect(m.stopped[0]!.example).toBe(false);
  });

  it("still credits the spotter when the relative was only asked, or said it was them", () => {
    for (const w of ["Asked Tom", "Tom: it was me", "Not asked"]) {
      const m = granMonth([row({ id: "x", outcome: "Denied", wasItYou: w })], new Map(), { who: null, spotter: "Sam", now: NOW });
      expect(m.stopped[0]!.by).toBe("Sam said no");
    }
  });

  it("falls back to a calm line that names the relative when there is no reason, in English and Polish", () => {
    const rows = [row({ id: "tom", outcome: "Denied", wasItYou: "Tom: not me" })];
    expect(granMonth(rows, new Map(), { who: null, spotter: "Sam", now: NOW }).stopped[0]!.sentence).toBe("Someone said they were Tom. The real Tom said they never sent it.");
    expect(granMonth(rows, new Map(), { who: null, spotter: "Sam", now: NOW, lang: "pl" }).stopped[0]!.sentence).toBe("Ktoś podawał się za osobę: Tom. Tom powiedział(a), że tego nie wysłał(a).");
    expect(granMonth(rows, new Map(), { who: null, spotter: "Sam", now: NOW, lang: "pl" }).stopped[0]!.by).toBe("Nic nie zostało zapłacone");
  });

  it("explains a stop by what the check found (the case file), not by a rule like first time paying", () => {
    const m = granMonth([row({ id: "parcel", who: "Gran", outcome: "Denied", amount: 1.99 })], new Map([["parcel", parcelNote]]), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped[0]!.sentence).toBe('This looks like a fake parcel text: it uses a small £1.99 "redelivery fee" to get your card details.');
  });

  it("without a case file, uses the strongest sign's own words before the rules", () => {
    const noCase: CaseNote = { id: parcelNote.id, reasons: parcelNote.reasons, signs: parcelNote.signs };
    const m = granMonth([row({ id: "parcel", outcome: "Denied" })], new Map([["parcel", noCase]]), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped[0]!.sentence).toBe("A tight deadline is used to rush you before you can check whether the parcel is real.");
    const high: CaseNote = { ...noCase, signs: [...noCase.signs, { sign: "Pretending to be someone", severity: "high", why: "The text pretends to be a courier." }] };
    const h = granMonth([row({ id: "parcel", outcome: "Denied" })], new Map([["parcel", high]]), { who: null, spotter: "Sam", now: NOW });
    expect(h.stopped[0]!.sentence).toBe("The text pretends to be a courier.");
  });

  it("uses the rule reason only when nothing else was found", () => {
    const m = granMonth([row({ id: "r", outcome: "Stopped" })], new Map([["r", note("r", ["Over the £30.00 limit."])]]), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped[0]!.sentence).toBe("Over the £30.00 limit.");
  });
});

// R6-N2 and m9: Gran read "Tom says they didn't send it ... They tried 2 times" when one of the two was
// Sam's Not me, and "£954.97 kept this month" mixed the sample month with her own payments.
describe("round 6: who said no, and whose money", () => {
  const jamie = (o: Partial<GranRow> & Pick<GranRow, "id">) => row({ outcome: "Denied", payee: "jamie.k1994@mail.example", amount: 250, ...o });

  it("never merges repeats answered by different people, and names who said no on each, in the past tense", () => {
    const m = granMonth([jamie({ id: "tom", when: ago(1), wasItYou: "Tom: not me" }), jamie({ id: "sam", when: ago(2), wasItYou: "Sam: not me" })], new Map(), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped.map((s) => [s.id, s.times, s.sentence])).toEqual([
      ["tom", 1, "Someone said they were Tom. The real Tom said they never sent it."],
      ["sam", 1, "Someone said they were Sam. The real Sam said they never sent it."],
    ]);
    expect(m.kept).toBe(500);
  });

  it("never folds the spotter's no into the relative's Not me", () => {
    const m = granMonth([jamie({ id: "tom", when: ago(1), wasItYou: "Tom: not me" }), jamie({ id: "deny", when: ago(2) })], new Map(), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped.map((s) => [s.id, s.times, s.by])).toEqual([
      ["tom", 1, "Nothing was paid"],
      ["deny", 1, "Sam said no"],
    ]);
  });

  it("never merges the spotter's own Not me with the same spotter's plain no", () => {
    const m = granMonth([jamie({ id: "notme", when: ago(1), wasItYou: "Sam: not me" }), jamie({ id: "deny", when: ago(2) })], new Map(), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped.map((s) => [s.id, s.times, s.by])).toEqual([
      ["notme", 1, "Nothing was paid"],
      ["deny", 1, "Sam said no"],
    ]);
  });

  it("still merges repeats the same person said no to, and the total counts every try", () => {
    const m = granMonth([jamie({ id: "a", when: ago(1), wasItYou: "Tom: not me" }), jamie({ id: "b", when: ago(2), wasItYou: "Tom: not me" })], new Map(), { who: null, spotter: "Sam", now: NOW });
    expect(m.stopped.map((s) => [s.id, s.times])).toEqual([["a", 2]]);
    expect(m.kept).toBe(500);
    expect(granForAgent(m, NOW).keptThisMonth).toBe("£500.00");
  });

  it("past tense in Polish too", () => {
    const m = granMonth([jamie({ id: "tom", wasItYou: "Tom: not me" })], new Map(), { who: null, spotter: "Sam", now: NOW, lang: "pl" });
    expect(m.stopped[0]!.sentence).toBe("Ktoś podawał się za osobę: Tom. Tom powiedział(a), że tego nie wysłał(a).");
  });

  it("keeps the sample month's money apart from Gran's own, on screen and for the assistant", () => {
    const rows = [
      jamie({ id: "live", wasItYou: "Tom: not me" }),
      row({ id: "s1", outcome: "Stopped", payee: "New number (Hi Mum)", amount: 400, sample: "Yes" }),
      row({ id: "s2", outcome: "Denied", payee: "parcel-redelivery.co", amount: 2.99, sample: "Yes" }),
    ];
    const m = granMonth(rows, new Map(), { who: null, spotter: "Sam", now: NOW });
    expect(m.kept).toBe(250);
    expect(m.keptSample).toBe(402.99);
    const told = granForAgent(m, NOW);
    expect(told.keptThisMonth).toBe("£250.00");
    expect(told.keptInSampleMonth).toBe("£402.99");
    // only sample: her own total is nothing, and the sample total is labelled
    const onlySample = granMonth(rows.slice(1), new Map(), { who: null, spotter: "Sam", now: NOW });
    expect(onlySample.kept).toBe(0);
    expect(onlySample.keptSample).toBe(402.99);
    // no sample at all: nothing for the assistant to mix up
    expect(granForAgent(granMonth(rows.slice(0, 1), new Map(), { who: null, spotter: "Sam", now: NOW }), NOW)).not.toHaveProperty("keptInSampleMonth");
  });
});
