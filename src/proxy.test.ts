import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { REC_COOKIE } from "@/core/recording";

const run = (url: string) => proxy(new NextRequest(url));

describe("recording mode cookie", () => {
  it("?rec=1 sets the cookie and sends the browser back to the same page without the switch in the address", () => {
    const res = run("https://spotter-pay.vercel.app/dashboard?tab=all&rec=1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://spotter-pay.vercel.app/dashboard?tab=all");
    const c = res.cookies.get(REC_COOKIE);
    expect(c?.value).toBe("1");
    expect(c?.path).toBe("/");
    expect(c?.httpOnly).toBe(true);
    expect(c?.maxAge).toBeGreaterThan(0);
  });

  it("?rec=0 clears the cookie", () => {
    const res = run("http://localhost:3417/ledger?rec=0");
    expect(res.headers.get("location")).toBe("http://localhost:3417/ledger");
    const c = res.cookies.get(REC_COOKIE);
    expect(c?.value).toBe("");
    expect(c?.maxAge).toBe(0);
  });

  it("any other value changes nothing", () => {
    const res = run("http://localhost:3417/ledger?rec=maybe");
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(REC_COOKIE)).toBeUndefined();
  });
});
