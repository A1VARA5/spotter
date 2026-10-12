// Site wide: old links land somewhere real, a missing page is a Spotter page with a way on, and every way into the
// demo has one name (UX audit 12 Oct, findings 7 and 10).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import config from "../../next.config";
import NotFound from "./not-found";
import { DEMO_CTA } from "@/ui/DemoStart";

describe("old and guessed addresses", () => {
  it("sends /activity to Activity (/ledger) instead of a bare 404", async () => {
    const rules = (await config.redirects?.()) ?? [];
    expect(rules).toContainEqual(expect.objectContaining({ source: "/activity", destination: "/ledger", permanent: false }));
  });
});

describe("the not found page", () => {
  it("says what happened and offers Home and the demo, with the one demo label", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toMatch(/<h1[^>]*>[^<]*no page here/i);
    expect(html).toContain('href="/"');
    expect(html).toContain(DEMO_CTA);
    expect(html).toContain('action="/api/demo/start"');
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("honest money words for Not me (audit finding 14)", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  it("Tom's question says PayPal cancels the hold, on the landing phones and in the real Telegram and Discord asks", () => {
    for (const f of ["app/landing/HeroPhones.tsx", "app/landing/Walkthrough.tsx", "telegram/notify.ts", "discord/notify.ts"])
      expect(read(f), f).toContain("Not me and PayPal cancels the hold straight away.");
  });

  it("the landing and /how never say Not me releases it or PayPal lets the money go", () => {
    for (const f of ["app/page.tsx", "app/landing/HeroScenes.tsx", "app/landing/Walkthrough.tsx", "app/how/page.tsx", "app/how/faq.ts", "app/was-it-you/page.tsx"])
      expect(read(f), f).not.toMatch(/releases it|lets the £\d+ go|it(&apos;|')s released/);
    expect(read("app/landing/Walkthrough.tsx")).toContain("PayPal cancels the hold. Gran keeps her £250.");
  });
});

describe("one label for the demo", () => {
  it("is Try it on fake money", () => {
    expect(DEMO_CTA).toBe("Try it on fake money");
  });

  it("is never renamed where a page starts the demo", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.tsx$/.test(n) ? [p] : [];
      });
    const renamed = walk(join(__dirname, "..")).filter((f) => /<DemoStart[^>]*\blabel=/.test(readFileSync(f, "utf8")));
    expect(renamed).toEqual([]);
  });
});
