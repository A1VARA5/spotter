import { describe, expect, it } from "vitest";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { COVERAGE, coverageFor, toolsFor, TOOLKIT_VERSION, type Job } from "./toolkit-coverage";

// Every action flag on, so getTools() returns the whole toolkit.
const everything = new Proxy({}, { get: () => new Proxy({}, { get: () => true }) }) as never;
const official = new PayPalMCPToolkit({ accessToken: "unused", configuration: { actions: everything, context: { sandbox: true } } }).getTools();

describe("the toolkit coverage table", () => {
  it("covers every tool in PayPal's Agent Toolkit 1.11.0 exactly once, and nothing else", () => {
    expect(TOOLKIT_VERSION).toBe("1.11.0");
    const ours = COVERAGE.map((c) => c.tool).sort();
    expect(new Set(ours).size).toBe(ours.length);
    expect(ours).toEqual(official.map((t) => t.method).sort());
    expect(ours.length).toBe(47);
  });

  it("says why for every tool and every job, in plain words without dashes", () => {
    for (const c of COVERAGE) {
      for (const job of ["shopping", "selling"] as Job[]) {
        const why = coverageFor(c.tool, job)!.why;
        expect(why.length, `${c.tool} ${job}`).toBeGreaterThan(20);
        expect(why, `${c.tool} ${job}`).not.toMatch(/[–—]/);
      }
    }
  });

  it("a shopping agent: create_order and pay_order guarded, get_order passed through, seller tools are bait", () => {
    const t = (tool: string) => coverageFor(tool, "shopping")!.treatment;
    expect(t("create_order")).toBe("guarded");
    expect(t("pay_order")).toBe("guarded");
    expect(t("create_subscription")).toBe("guarded");
    expect(t("get_order")).toBe("passthrough");
    for (const bait of ["create_refund", "accept_dispute_claim", "send_invoice", "create_invoice", "list_transactions", "cancel_subscription", "create_shipment_tracking"]) {
      expect(t(bait), bait).toBe("bait");
    }
    expect(t("get_merchant_insights")).toBe("hidden");
  });

  it("a selling agent: refunds and shipment tracking guarded, nothing it could honestly need is bait", () => {
    const t = (tool: string) => coverageFor(tool, "selling")!.treatment;
    expect(t("create_refund")).toBe("guarded");
    expect(t("create_shipment_tracking")).toBe("guarded");
    expect(t("create_subscription")).toBe("guarded");
    expect(t("send_invoice")).toBe("hidden");
  });

  it("toolsFor lists what the MCP server offers: never a hidden tool, never one that approves", () => {
    for (const job of ["shopping", "selling"] as Job[]) {
      const listed = toolsFor(job);
      for (const c of listed) expect(c.treatment).not.toBe("hidden");
      expect(listed.some((c) => /approve/.test(c.tool))).toBe(false);
    }
    expect(toolsFor("shopping").map((c) => c.tool)).toContain("create_refund");
  });
});
