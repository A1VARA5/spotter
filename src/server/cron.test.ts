import { describe, expect, it, vi } from "vitest";
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

  it("runs every job and says what each did (counts, or a price watch summary)", async () => {
    const res = await handleDaily(req("Bearer right"), "right", {
      settled: async () => 2,
      renewed: async () => 1,
      askedAgain: async () => 3,
      watches: async () => ({ expired: 1, stopped: 1, checked: 3, dropped: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settled: 2, renewed: 1, askedAgain: 3, watches: { expired: 1, stopped: 1, checked: 3, dropped: 1 } });
  });

  it("one failing job doesn't stop the others, and the failure is reported as JSON with a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let asked = false;
    let watched = false;
    const res = await handleDaily(req("Bearer right"), "right", {
      settled: async () => {
        throw new Error("PayPal down");
      },
      askedAgain: async () => ((asked = true), 1),
      watches: async () => ((watched = true), { checked: 0 }),
    });
    expect(asked && watched).toBe(true);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ settled: { error: "settled failed." }, askedAgain: 1, watches: { checked: 0 }, error: "Failed: settled." });
  });

  it("still settles payments when the price watches fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleDaily(req("Bearer right"), "right", {
      settled: async () => 2,
      watches: async () => {
        throw new Error("Channel3 down");
      },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ settled: 2, watches: { error: "watches failed." }, error: "Failed: watches." });
  });
});
