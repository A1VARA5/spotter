import { describe, expect, it } from "vitest";
import { labelsFor, ON_HOLD, OUTCOME_WORDS } from "./labels";
import { STATE_LABEL } from "./format";

describe("labels", () => {
  it("families read exactly as before", () => {
    const f = labelsFor("family");
    expect(f.peopleQ).toBe("Who are you looking out for?");
    expect(f.nameSub).toBe("This is the name your people see when a payment waits for you.");
    expect(f.kind).toEqual({ person: "Relative", kid: "Kid", agent: "AI agent" });
    expect(f.agentName).toBe("Shopping agent");
    expect(labelsFor(undefined)).toBe(f);
  });

  it("a business has an approver, staff and AI buying agents", () => {
    const b = labelsFor("business");
    expect(b.nameSub).toMatch(/approver/);
    expect(b.kind).toMatchObject({ person: "Staff", agent: "AI buying agent" });
    expect(b.peopleSub).toMatch(/New suppliers/);
  });
});

describe("one vocabulary", () => {
  it("names each outcome once, the same on every page", () => {
    expect(OUTCOME_WORDS.held).toMatchObject({ short: "Waiting", long: "Waiting for you" });
    expect(OUTCOME_WORDS.blocked).toMatchObject({ short: "Stopped", long: "Stopped" });
    expect(OUTCOME_WORDS.protected.short).toBe("Protected");
    expect(OUTCOME_WORDS.returned.short).toBe("Denied");
    expect(OUTCOME_WORDS.paid.short).toBe("Paid");
    expect(ON_HOLD).toBe("on hold at PayPal");
  });

  it("the status pills every page uses come from here", () => {
    for (const [k, v] of Object.entries(OUTCOME_WORDS)) expect(STATE_LABEL[k as keyof typeof STATE_LABEL]).toBe(v.long);
  });

  it("no hyphens, dashes or curly quotes in the words", () => {
    const all = Object.values(OUTCOME_WORDS).flatMap((v) => [v.short, v.long, v.explain]).join(" ");
    expect(all).not.toMatch(/[–—‘’“”]|\w-\w/);
  });
});
