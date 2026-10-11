import { describe, expect, it, vi } from "vitest";
import { COVERAGE } from "@/core/toolkit-coverage";
import { SPOTTER_RUNS, toolkitRun } from "./toolkit";

describe("what Spotter itself may run through PayPal's toolkit", () => {
  it("never a bait or hidden tool, for any job", () => {
    for (const c of COVERAGE) {
      const used = [c.shopping, c.selling].some((s) => s.treatment === "guarded" || s.treatment === "passthrough");
      if (!used) expect(SPOTTER_RUNS.has(c.tool), c.tool).toBe(false);
    }
  });

  it("refuses a bait tool before anything reaches PayPal", async () => {
    const api = { run: vi.fn(async () => "{}") };
    const make = vi.fn(async () => api);
    await expect(toolkitRun("accept_dispute_claim", { dispute_id: "PP-D-1", note: "x" }, {}, make)).rejects.toThrow(/never runs/);
    await expect(toolkitRun("list_transactions", {}, {}, make)).rejects.toThrow(/never runs/);
    expect(api.run).not.toHaveBeenCalled();
    await toolkitRun("get_order", { id: "5O190127TN364715T" }, {}, make);
    expect(api.run).toHaveBeenCalledWith("get_order", { id: "5O190127TN364715T" });
  });

  it("sends the toolkit a PayPal-Request-Id (context.request_id) when one is given, and sandbox always", async () => {
    const make = vi.fn(async () => ({ run: async () => "{}" }));
    await toolkitRun("create_refund", { capture_id: "2GG279541U471931P" }, { requestId: "refund-ref_1" }, make);
    expect(make).toHaveBeenCalledWith({ sandbox: true, request_id: "refund-ref_1" });
    await toolkitRun("get_order", { id: "5O190127TN364715T" }, {}, make);
    expect(make).toHaveBeenLastCalledWith({ sandbox: true });
  });

  it("gives up with a visible error when PayPal doesn't answer in time", async () => {
    const make = async () => ({ run: () => new Promise<string>(() => {}) });
    await expect(toolkitRun("create_refund", { capture_id: "2GG279541U471931P" }, { timeoutMs: 20 }, make)).rejects.toThrow(/PayPal didn't answer/);
  });
});
