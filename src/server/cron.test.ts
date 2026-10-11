import { describe, expect, it, vi } from "vitest";
import { handleReconcile } from "./cron";

const req = (auth?: string) => new Request("https://x/api/cron/reconcile", { headers: auth ? { authorization: auth } : {} });

describe("daily reconcile job", () => {
  it("refuses to run without a configured secret", async () => {
    expect((await handleReconcile(req("Bearer x"), undefined, async () => 0)).status).toBe(503);
  });

  it("refuses a caller without the secret", async () => {
    let ran = false;
    const res = await handleReconcile(req("Bearer wrong"), "right", async () => ((ran = true), 0));
    expect(res.status).toBe(401);
    expect(ran).toBe(false);
  });

  it("settles stuck payments and says how many", async () => {
    const res = await handleReconcile(req("Bearer right"), "right", async () => 2);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settled: 2 });
  });

  it("reports a failure as JSON instead of throwing", async () => {
    const res = await handleReconcile(req("Bearer right"), "right", async () => {
      throw new Error("PayPal down");
    });
    expect(res.status).toBe(500);
  });

  it("also polls price watches and reports what it did", async () => {
    const watches = async () => ({ expired: 1, stopped: 1, checked: 3, dropped: 1 });
    const res = await handleReconcile(req("Bearer right"), "right", async () => 0, watches);
    expect(await res.json()).toEqual({ settled: 0, watches: { expired: 1, stopped: 1, checked: 3, dropped: 1 } });
  });

  it("still settles payments when the price watches fail, and says so with a 500 for monitoring", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleReconcile(req("Bearer right"), "right", async () => 2, async () => {
      throw new Error("Channel3 down");
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ settled: 2, watches: { error: "Price watches failed." } });
  });

  it("still runs the price watches when settling payments fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let ran = false;
    const res = await handleReconcile(
      req("Bearer right"),
      "right",
      async () => {
        throw new Error("PayPal down");
      },
      async () => ((ran = true), { checked: 0 }),
    );
    expect(ran).toBe(true);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Reconcile failed.", watches: { checked: 0 } });
  });
});
