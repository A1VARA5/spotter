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
    await expect(toolkitRun("accept_dispute_claim", { dispute_id: "PP-D-1", note: "x" }, api)).rejects.toThrow(/never runs/);
    await expect(toolkitRun("list_transactions", {}, api)).rejects.toThrow(/never runs/);
    expect(api.run).not.toHaveBeenCalled();
    await toolkitRun("get_order", { id: "5O190127TN364715T" }, api);
    expect(api.run).toHaveBeenCalledWith("get_order", { id: "5O190127TN364715T" });
  });
});
