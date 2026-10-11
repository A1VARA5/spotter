import { describe, expect, it } from "vitest";
import { handleDaily } from "./cron";

const req = (auth?: string) => new Request("https://x/api/cron/reconcile", { headers: auth ? { authorization: auth } : {} });

describe("daily jobs", () => {
  it("refuses to run without a configured secret", async () => {
    expect((await handleDaily(req("Bearer x"), undefined, { settled: async () => 0 })).status).toBe(503);
  });

  it("refuses a caller without the secret", async () => {
    let ran = false;
    const res = await handleDaily(req("Bearer wrong"), "right", { settled: async () => ((ran = true), 0) });
    expect(res.status).toBe(401);
    expect(ran).toBe(false);
  });

  it("runs every job and says how many each handled", async () => {
    const res = await handleDaily(req("Bearer right"), "right", { settled: async () => 2, renewed: async () => 1, askedAgain: async () => 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settled: 2, renewed: 1, askedAgain: 3 });
  });

  it("one failing job doesn't stop the others, and the failure is reported as JSON", async () => {
    let asked = false;
    const res = await handleDaily(req("Bearer right"), "right", {
      settled: async () => {
        throw new Error("PayPal down");
      },
      askedAgain: async () => ((asked = true), 1),
    });
    expect(asked).toBe(true);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ askedAgain: 1, error: "Failed: settled." });
  });
});
