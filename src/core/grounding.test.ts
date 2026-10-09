import { describe, expect, it } from "vitest";
import { groundFlags, type Flag } from "./grounding";

const ctx = `Hi Mum, it's me, I dropped my phone in the bath.
This is my new number. Can you   send £400 to my friend's account, Friends and Family please, it's urgent!!`;

const flag = (quote: string, over: Partial<Flag> = {}): Flag => ({
  kind: "pressure",
  severity: "high",
  quote,
  why: "test",
  ...over,
});

describe("groundFlags", () => {
  it("keeps a flag whose quote is really in the context", () => {
    const r = groundFlags([flag("This is my new number.")], ctx);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it("drops a flag with an invented quote", () => {
    const r = groundFlags([flag("send it in Bitcoin")], ctx);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it("matches across collapsed whitespace, line breaks and case", () => {
    const r = groundFlags([flag("can you send £400 to my FRIEND'S account")], ctx);
    expect(r.kept).toHaveLength(1);
  });

  it("drops empty or whitespace quotes", () => {
    expect(groundFlags([flag(""), flag("   ")], ctx).kept).toHaveLength(0);
  });

  it("caps at 6 flags and counts the rest as dropped", () => {
    const flags = Array.from({ length: 8 }, () => flag("urgent"));
    const r = groundFlags(flags, ctx);
    expect(r.kept).toHaveLength(6);
    expect(r.dropped).toBe(2);
  });

  it("keeps high severity flags first when capping", () => {
    const flags = [
      ...Array.from({ length: 6 }, () => flag("urgent", { severity: "low" })),
      flag("Friends and Family please", { severity: "high", kind: "friends_and_family" }),
    ];
    expect(groundFlags(flags, ctx).kept[0]!.kind).toBe("friends_and_family");
  });
});
