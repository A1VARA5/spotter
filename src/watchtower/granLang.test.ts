import { describe, expect, it } from "vitest";
import { GLOSSARY, GRAN_TEXT, PL_NEVER, TRICK_KEY, granAiText, granLanguageRule, granLocaleText, gt, outcomeIn } from "./granLang";
import { SIGN_LABEL } from "./data";

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("every Gran string has a translation", () => {
  for (const [key, v] of Object.entries(GRAN_TEXT)) {
    it(key, () => {
      expect(v.en.trim()).not.toBe("");
      expect(v.pl.trim()).not.toBe("");
      expect(v.pl).not.toBe(v.en);
      expect(holes(v.pl)).toEqual(holes(v.en));
    });
  }
  it("follows the house style in both languages: straight quotes, no long dashes", () => {
    for (const v of Object.values(GRAN_TEXT)) for (const s of [v.en, v.pl]) expect(s).not.toMatch(/[–—“”„‘’]/);
  });
  it("has a trick for every scam sign Spotter labels", () => {
    expect(Object.keys(TRICK_KEY).sort()).toEqual(Object.values(SIGN_LABEL).sort());
  });
});

describe("the words that matter", () => {
  it("never makes a waiting payment read like an approved one", () => {
    expect(PL_NEVER.some((w) => GLOSSARY.held.pl.includes(w))).toBe(false);
    for (const v of Object.values(GRAN_TEXT)) for (const w of PL_NEVER) expect(v.pl.toLowerCase()).not.toContain(w);
    expect(outcomeIn("pl", "Waiting")).toBe("Czeka");
    expect(outcomeIn("pl", "Stopped")).toBe("Zatrzymana");
    expect(outcomeIn("pl", "Paid")).toBe("Zapłacona");
    expect(outcomeIn("en", "Waiting")).toBe("Waiting");
    expect(outcomeIn("pl", "Something new")).toBe("Something new");
  });
  it("keeps the advice word for word from the glossary", () => {
    expect(gt("pl", "advice")).toBe("Nie płać. Zadzwoń do tej osoby na numer, który już masz, a nie na numer z wiadomości.");
    expect(gt("en", "advice")).toBe("Don't pay. Ring them on a number you already have, not one from the message.");
    expect(gt("pl", "waitingTitle", { spotter: "Sam" })).toBe("Czeka na decyzję: Sam");
  });
  it("fills placeholders as plain text and leaves unknown ones alone", () => {
    expect(gt("en", "byDenied", { spotter: "<b>Sam</b>" })).toBe("<b>Sam</b> said no");
    expect(gt("en", "byDenied")).toBe("{spotter} said no");
  });
});

describe("AG Studio's own words and the agent's", () => {
  it("uses AG's Polish locale for Studio in Polish, and Studio's default in English", () => {
    const pl = granLocaleText("pl")!;
    expect(pl.aiSubmitButton).toBe("Wyślij");
    expect(Object.keys(pl).length).toBeGreaterThan(500);
    expect(granLocaleText("en")).toBeUndefined();
  });
  it("tells the model the tool's words are Polish only in Polish", () => {
    expect(granAiText("en")).toBeUndefined();
    expect(granAiText("pl")!["tools.my_month.description"]).toMatch(/Polish/);
  });
  it("adds no language rule in English, and in Polish forbids the approval words", () => {
    expect(granLanguageRule("en", "Sam")).toBe("");
    const rule = granLanguageRule("pl", "Sam");
    for (const w of PL_NEVER) expect(rule).toContain(w);
    expect(rule).toMatch(/never tell them to approve/);
  });
});
