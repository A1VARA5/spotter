import { describe, expect, it } from "vitest";
import { alertFor, exampleAmount, meName, payerFor } from "./preview-copy";

describe("setup preview copy", () => {
  it("uses the typed name, and 'you' until there is one", () => {
    expect(meName("  Sam ")).toBe("Sam");
    expect(meName("")).toBe("you");
    expect(meName("You")).toBe("you");
  });

  it("picks an example payment just over the limit they set, in round pounds", () => {
    expect(exampleAmount(5000)).toBe(6000);
    expect(exampleAmount(3000)).toBe(4000);
    expect(exampleAmount(25000)).toBe(30000);
    expect(exampleAmount(499)).toBe(1000);
    // No limit typed: a plain everyday amount.
    expect(exampleAmount(undefined)).toBe(6000);
    expect(exampleAmount(0)).toBe(2000);
  });

  it("writes the held alert from the rule that was just set", () => {
    const a = alertFor({ who: "Gran", askAbove: 5000 });
    expect(a.title).toBe("Gran wants to pay £60");
    expect(a.body).toBe("Over the £50 you set for one payment. The money is on hold at PayPal.");
    const zero = alertFor({ who: "Leo", askAbove: 0 });
    expect(zero.body).toBe("You asked to see every payment. The money is on hold at PayPal.");
    const agent = alertFor({ who: "Shopping agent", askAbove: 3000 });
    expect(agent.title).toBe("Shopping agent wants to pay £40");
    const biz = alertFor({ who: "Tom", askAbove: 25000 });
    expect(biz.body).toBe("Over the £250 you set for one payment. The money is on hold at PayPal.");
  });

  it("names the person being added first, then someone already added, then a stand in", () => {
    expect(payerFor({ draftName: "Nan", people: [{ name: "Gran", kind: "person" }], kind: "family" })).toBe("Nan");
    expect(payerFor({ draftName: " ", people: [{ name: "Shopping agent", kind: "agent" }, { name: "Gran", kind: "person" }], kind: "family" })).toBe("Gran");
    expect(payerFor({ draftName: "", people: [], kind: "family" })).toBe("Gran");
    expect(payerFor({ draftName: "", people: [], kind: "business" })).toBe("Tom");
    // Never the same name as the spotter typed, or the preview reads "What Tom sees: Tom is looking".
    expect(payerFor({ draftName: "", people: [], kind: "business", avoid: "tom" })).toBe("Ana");
    expect(payerFor({ draftName: "", people: [], kind: "family", avoid: "Gran" })).toBe("Nan");
  });
});
