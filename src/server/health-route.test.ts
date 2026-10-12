import { describe, expect, it } from "vitest";
import { healthResponse } from "./health-route";
import type { HealthReport } from "./health";

const REPORT: HealthReport = { status: "ok", checkedAt: "2026-10-12T00:00:00.000Z", cachedFor: 60, checks: [] };
const req = (ip: string) => new Request("http://x/api/health", { headers: { "x-forwarded-for": ip } });

describe("healthResponse", () => {
  it("answers with the report, cacheable for a minute", async () => {
    const r = await healthResponse(req("1.1.1.1"), { get: async () => REPORT }, () => true, (x) => x);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(REPORT);
    expect(r.headers.get("cache-control")).toContain("max-age=30");
  });

  it("says 429 with Retry-After when the address asked too often", async () => {
    const r = await healthResponse(req("1.1.1.1"), { get: async () => REPORT }, () => false, (x) => x);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });

  it("never passes an error's text on", async () => {
    const r = await healthResponse(
      req("1.1.1.1"),
      {
        get: async () => {
          throw new Error("postgres://user:secret@host");
        },
      },
      () => true,
      (x) => x,
      { error: () => {} },
    );
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("secret");
  });
});
