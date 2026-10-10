import { describe, expect, it } from "vitest";
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
});
