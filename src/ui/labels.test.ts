import { describe, expect, it } from "vitest";
import { labelsFor } from "./labels";

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
